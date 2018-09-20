var lib = require('./lib/');

const ITEM_PREFIX_RE = /item./;
const ITEM_SELECTOR_RE = /item.(\w+)/;

/**
 * Render array from state.
 */
AFRAME.registerComponent('bind-for', {
  schema: {
    for: {type: 'string', default: 'item'},
    in: {type: 'string'},
    key: {type: 'string'},
    pool: {default: 0},
    template: {type: 'string'},
    updateInPlace: {default: false}
  },

  init: function () {
    // Subscribe to store and register handler to do data-binding to components.
    this.system = this.el.sceneEl.systems.state;
    this.onStateUpdate = this.onStateUpdate.bind(this);

    this.keysToWatch = [];
    this.renderedKeys = [];  // Keys that are currently rendered.
    this.system.subscribe(this);

    if (this.el.children[0] && this.el.children[0].tagName === 'TEMPLATE') {
      this.template = this.el.children[0].innerHTML.trim();
    } else {
      this.template = document.querySelector(this.data.template).innerHTML.trim();
    }

    for (let i = 0; i < this.data.pool; i++) {
      this.el.appendChild(this.generateFromTemplate(null, i));
    }
  },

  update: function () {
    this.keysToWatch[0] = lib.split(this.data.in, '.')[0];
    this.onStateUpdate();
  },

  /**
   * When items are swapped out, the old ones are removed, and new ones are added. All
   * entities will be reinitialized.
   */
  onStateUpdateNaive: (function () {
    var keys = [];

    return function () {
      var child;
      var data = this.data;
      var el = this.el;
      var i;
      var list;
      var key;
      var keyValue;

      try {
        list = lib.select(this.system.state, data.in);
      } catch (e) {
        throw new Error(`[aframe-state-component] Key '${data.in}' not found in state.` +
                        ` #${el.getAttribute('id')}[${this.attrName}]`);
      }

      keys.length = 0;
      for (i = 0; i < list.length; i++) {
        let item = list[i];

        // If key not defined, use index (e.g., array of strings).
        keyValue = data.key ? item[data.key].toString() : item.toString();
        keys.push(keyValue);

        // Add item.
        if (this.renderedKeys.indexOf(keyValue) === -1) {
          el.appendChild(this.generateFromTemplate(item, i));
          this.renderedKeys.push(keyValue);
        }
      }

      // Remove items by removing entities.
      const toRemoveEls = this.getElsToRemove(keys, this.renderedKeys);
      for (i = 0; i < toRemoveEls.length; i++) {
        toRemoveEls[i].parentNode.removeChild(toRemoveEls[i]);
      }

      // Update bind-for-key indices for list of strings in case of re-order.
      if (list.length && list[0].constructor === String) {
        for (i = 0; i < list.length; i++) {
          child = el.querySelector('[data-bind-for-value="' + list[i] + '"]');
          if (child) {
            child.setAttribute('data-bind-for-key', i.toString());
          }
        }
      }

      this.el.emit('bindforrender', null, false);
    };
  })(),

  /**
   * When items are swapped out, this algorithm will update component values in-place using
   * bind-item.
   */
  onStateUpdateInPlace: (function () {
    var keys = [];

    return function () {
      var child;
      var data = this.data;
      var el = this.el;
      var i;
      var list;
      var key;
      var keyValue;

      try {
        list = lib.select(this.system.state, data.in);
      } catch (e) {
        throw new Error(`[aframe-state-component] Key '${data.in}' not found in state.` +
                        ` #${el.getAttribute('id')}[${this.attrName}]`);
      }

      // Calculate keys that should be active.
      keys.length = 0;
      for (i = 0; i < list.length; i++) {
        let item = list[i];
        keyValue = data.key ? item[data.key].toString() : item.toString();
        keys.push(keyValue);
      }

      // Remove items by pooling. Do before adding.
      const toRemoveEls = this.getElsToRemove(keys, this.renderedKeys);
      for (let i = 0; i < toRemoveEls.length; i++) {
        toRemoveEls[i].object3D.visible = false;
        toRemoveEls[i].setAttribute('data-bind-for-active', 'false');
        toRemoveEls[i].removeAttribute('data-bind-for-key');
        toRemoveEls[i].removeAttribute('data-bind-for-value');
        toRemoveEls[i].emit('bindfordeactivate', null, false);
        toRemoveEls[i].pause();
      }

      for (i = 0; i < list.length; i++) {
        let item = list[i];

        let bindForKey = this.getBindForKey(item, i);
        keyValue = data.key ? item[data.key].toString() : item.toString();

        // Add item.
        if (this.renderedKeys.indexOf(keyValue) === -1) {
          if (!el.querySelector(':scope > [data-bind-for-active="false"]')) {
            // No items available in pool. Generate new entity.
            const newEl = this.generateFromTemplate(item, i);
            newEl.addEventListener('loaded', () => {
              newEl.emit('bindforupdateinplace', item, false);
            });
            el.appendChild(newEl);
          } else {
            // Take over inactive item.
            const takeoverEl = el.querySelector('[data-bind-for-active="false"]');
            takeoverEl.setAttribute('data-bind-for-key', bindForKey);
            takeoverEl.setAttribute('data-bind-for-value', keyValue);
            takeoverEl.object3D.visible = true;
            takeoverEl.play();
            takeoverEl.setAttribute('data-bind-for-active', 'true');
            takeoverEl.emit('bindforupdateinplace', item, false);
          }
          this.renderedKeys.push(keyValue);
        } else if (keys.indexOf(bindForKey) !== -1) {
          // Update item.
          this.el.querySelector('[data-bind-for-key="' + bindForKey + '"]')
            .emit('bindforupdateinplace', item, false);
        }
      }

      // Update bind-for-key indices for list of strings in case of re-order.
      if (list.length && list[0].constructor === String) {
        for (i = 0; i < list.length; i++) {
          child = el.querySelector('[data-bind-for-value="' + list[i] + '"]');
          if (child) {
            child.setAttribute('data-bind-for-key', i.toString());
          }
        }
      }

      this.el.emit('bindforrender', null, false);
    };
  })(),

  /**
   * Generate entity from template.
   */
  generateFromTemplate: function (item, i) {
    const data = this.data;

    this.el.appendChild(this.system.renderTemplate(this.template, item));
    const newEl = this.el.children[this.el.children.length - 1];;

    // From pool.true
    if (!item) {
      newEl.setAttribute('data-bind-for-key', '');
      newEl.setAttribute('data-bind-for-active', 'false');
      return newEl;
    }

    const bindForKey = this.getBindForKey(item, i);
    newEl.setAttribute('data-bind-for-key', bindForKey);
    if (!data.key) { newEl.setAttribute('data-bind-for-value', item); }

    // Keep track of pooled and non-pooled entities if updating in place.
    newEl.setAttribute('data-bind-for-active', 'true');
    return newEl;
  },

  /**
   * Get entities marked for removal.
   *
   * @param {array} activeKeys - List of key values that should be active.
   * @param {array} renderedKeys - List of key values currently rendered.
   */
  getElsToRemove: (function () {
    const toRemove = [];

    return function (activeKeys, renderedKeys) {
      const data = this.data;
      const el = this.el;

      toRemove.length = 0;
      for (let i = 0; i < el.children.length; i++) {
        if (el.children[i].tagName === 'TEMPLATE') { continue; }
        let key = data.key ?
          el.children[i].getAttribute('data-bind-for-key') :
          el.children[i].getAttribute('data-bind-for-value');
        if (activeKeys.indexOf(key) === -1 && renderedKeys.indexOf(key) !== -1) {
          toRemove.push(el.children[i]);
          renderedKeys.splice(renderedKeys.indexOf(key), 1);
        }
      }
      return toRemove;
    };
  })(),

  /**
   * Get value to use as the data-bind-for-key.
   * For items, will be value specified by `bind-for.key`.
   * For simple list, will be the index.
   */
  getBindForKey: function (item, i) {
    return this.data.key ? item[this.data.key].toString() : i.toString();
  },

  /**
   * Handle state update.
   */
  onStateUpdate: function () {
    if (this.data.updateInPlace) {
      this.onStateUpdateInPlace();
    } else {
      this.onStateUpdateNaive();
    }
  }
});

/**
 * Handle parsing and update in-place updates under bind-for.
 */
AFRAME.registerComponent('bind-item', {
  schema: {
    type: 'string'
  },

  multiple: true,

  init: function () {
    this.itemData = null;
    this.keysToWatch = [];
    this.prevValues = {};

    // Listen to root item for events.
    const rootEl = this.rootEl = this.el.closest('[data-bind-for-key]');
    if (!rootEl) {
      throw new Error('bind-item component must be attached to entity under a bind-for item.');
    }
    rootEl.addEventListener('bindforupdateinplace', this.updateInPlace.bind(this));
    rootEl.addEventListener('bindfordeactivate', this.deactivate.bind(this));

    this.el.sceneEl.systems.state.subscribe(this);
  },

  update: function () {
    this.parseSelector();
  },

  /**
   * Run with bind-for tells to via event `bindforupdateinplace`, passing item data.
   */
  updateInPlace: function (evt) {
    const propertyMap = this.propertyMap;

    if (this.rootEl.getAttribute('data-bind-for-active') === 'false') { return; }

    if (evt) { this.itemData = evt.detail; }

    for (let property in propertyMap) {
      // Get value from item.
      let value = this.select(this.itemData, propertyMap[property]);

      // Diff against previous value.
      if (value === this.prevValues[property]) { continue; }

      // Update.
      AFRAME.utils.entity.setComponentProperty(this.el, property, value);

      this.prevValues[property] = value;
    }
  },

  onStateUpdate: function () {
    this.updateInPlace();
  },

  select: function (itemData, selector) {
    var value;

    if (selector.indexOf('=') !== -1) {
      // Interpolate.
      let match = selector.match(ITEM_SELECTOR_RE);
      if (match) {
        value = lib.select(itemData, match[0].replace(ITEM_PREFIX_RE, ''));
        selector = selector.replace(ITEM_SELECTOR_RE, "'" + value + "'");
      }

      value = lib.select(this.el.sceneEl.systems.state.state, selector);
    } else {
      // Get value from item.
      value = selector === 'item'
        ? itemData // Simple list.
        : lib.select(itemData, selector.replace(ITEM_PREFIX_RE, ''));
    }

    return value;
  },

  deactivate: function () {
    this.prevValues = {};
  },

  parseSelector: function () {
    const propertyMap = this.propertyMap = {};
    this.keysToWatch.length = 0;

    const componentName = lib.split(this.id, '__')[0];

    // Different parsing for multi-prop components.
    if (componentName in AFRAME.components && !AFRAME.components[componentName].isSingleProp) {
      const propertySplitList = lib.split(this.data, ';');
      for (let i = 0; i < propertySplitList.length; i++) {
        let propertySplit = lib.split(propertySplitList[i], ':');
        propertyMap[this.id + '.' + propertySplit[0].trim()] = propertySplit[1].trim();
        lib.parseKeysToWatch(this.keysToWatch, propertySplit[1].trim(), true);
      }
      return;
    }

    propertyMap[this.id] = this.data;
    lib.parseKeysToWatch(this.keysToWatch, this.data, true);
  }
});