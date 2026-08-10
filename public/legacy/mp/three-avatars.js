/* ===========================================================================
   MPThree — remote players in a Three.js scene.

   Shared by the ski games and any other WebGL world in the arcade: it keeps one
   avatar per remote player, moves them smoothly, hangs a name label over each
   one, and reports where they are on screen so chat bubbles can follow them.

   Avatars are cloned from the game's own player model when there is one, so
   another person on the mountain looks like a skier and not like a placeholder.
   Each clone is tinted toward that player's colour so you can tell them apart.
   =========================================================================== */

(function (global) {
  'use strict';

  function labelSprite(THREE, text, color) {
    var pad = 16;
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    ctx.font = '600 40px system-ui, sans-serif';
    var w = Math.ceil(ctx.measureText(text).width) + pad * 2;
    canvas.width = Math.max(64, w);
    canvas.height = 72;

    ctx = canvas.getContext('2d');
    ctx.font = '600 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Pill background so the name stays readable against snow or sky.
    var r = 18;
    ctx.fillStyle = 'rgba(11,18,32,0.78)';
    ctx.beginPath();
    ctx.moveTo(r, 6);
    ctx.lineTo(canvas.width - r, 6);
    ctx.quadraticCurveTo(canvas.width, 6, canvas.width, 6 + r);
    ctx.lineTo(canvas.width, 60 - r);
    ctx.quadraticCurveTo(canvas.width, 60, canvas.width - r, 60);
    ctx.lineTo(r, 60);
    ctx.quadraticCurveTo(0, 60, 0, 60 - r);
    ctx.lineTo(0, 6 + r);
    ctx.quadraticCurveTo(0, 6, r, 6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = color;
    ctx.fillRect(0, 56, canvas.width, 4);

    ctx.fillStyle = '#eef4fb';
    ctx.fillText(text, canvas.width / 2, 32);

    var tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    var sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 999;
    sprite.userData.aspect = canvas.width / canvas.height;
    return sprite;
  }

  function tint(THREE, root, hex, amount) {
    var target = new THREE.Color(hex);
    root.traverse(function (node) {
      if (!node.isMesh || !node.material) return;
      var mats = Array.isArray(node.material) ? node.material : [node.material];
      node.material = mats.map(function (m) {
        if (!m || !m.color) return m;
        var copy = m.clone();
        copy.color.lerp(target, amount);
        if (copy.emissive) copy.emissive.lerp(target, amount * 0.5);
        return copy;
      });
      if (!Array.isArray(node.material)) node.material = node.material[0];
    });
  }

  /**
   * A plain stand-in for games with no player model to clone. Built only from
   * primitives that have existed in Three.js forever -- these games pin a range
   * of versions, and CapsuleGeometry only arrived in r140.
   */
  function fallbackAvatar(THREE, hex, height) {
    var g = new THREE.Group();
    var mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.6, metalness: 0.1 });
    var body = new THREE.Mesh(
      new THREE.CylinderGeometry(height * 0.15, height * 0.17, height * 0.5, 12), mat);
    body.position.y = height * 0.6;
    g.add(body);
    var shoulders = new THREE.Mesh(new THREE.SphereGeometry(height * 0.16, 12, 10), mat);
    shoulders.position.y = height * 0.83;
    g.add(shoulders);
    var head = new THREE.Mesh(new THREE.SphereGeometry(height * 0.12, 14, 12),
      new THREE.MeshStandardMaterial({ color: 0xf0d9c0, roughness: 0.7 }));
    head.position.y = height * 0.95;
    g.add(head);
    var skiGeo = new THREE.BoxGeometry(height * 0.06, height * 0.02, height * 0.9);
    var skiMat = new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.4, metalness: 0.3 });
    [-1, 1].forEach(function (side) {
      var s = new THREE.Mesh(skiGeo, skiMat);
      s.position.set(side * height * 0.1, height * 0.02, 0);
      g.add(s);
    });
    return g;
  }

  function Avatars(opts) {
    this.THREE = opts.THREE;
    this.scene = opts.scene;
    this.camera = opts.camera;
    this.template = opts.template || null;   // () => Object3D to clone
    this.height = opts.height || 1.8;
    this.labelScale = opts.labelScale || 1;
    this.avatars = {};
  }

  Avatars.prototype = {

    _make: function (player) {
      var THREE = this.THREE;
      var body = null;
      var cloned = false;
      var src = typeof this.template === 'function' ? this.template() : this.template;
      if (src && src.clone) {
        try {
          body = src.clone(true);
          body.visible = true;
          tint(THREE, body, player.color, 0.42);
          cloned = true;
        } catch (e) {
          body = null;
        }
      }
      if (!body) body = fallbackAvatar(THREE, player.color, this.height);

      var group = new THREE.Group();
      group.add(body);

      var label = labelSprite(THREE, player.name, player.color);
      var h = this.height * 0.5 * this.labelScale;
      label.scale.set(h * label.userData.aspect, h, 1);
      label.position.y = this.height * 1.35;
      group.add(label);

      this.scene.add(group);
      var record = { group: group, body: body, label: label, name: player.name, cloned: cloned };
      this.avatars[player.id] = record;
      return record;
    },

    _templateReady: function () {
      var src = typeof this.template === 'function' ? this.template() : this.template;
      return !!(src && src.clone);
    },

    get: function (player) {
      var a = this.avatars[player.id];
      if (a && a.name !== player.name) {
        // Renamed mid-session: rebuild so the label is right.
        this.remove(player.id);
        a = null;
      } else if (a && !a.cloned && this._templateReady()) {
        // The game had no player model when this avatar was built (still on the
        // menu, resort not loaded yet). Now it does, so upgrade the stand-in.
        var where = a.group.position.clone();
        var rot = a.group.quaternion.clone();
        this.remove(player.id);
        a = this._make(player);
        a.group.position.copy(where);
        a.group.quaternion.copy(rot);
      }
      return a || this._make(player);
    },

    /** Place one player. `yaw` is radians about Y; pass null to skip rotation. */
    place: function (player, x, y, z, yaw, extra) {
      var a = this.get(player);
      a.group.position.set(x, y, z);
      if (yaw != null) a.group.rotation.y = yaw;
      if (extra && extra.scale) a.group.scale.setScalar(extra.scale);
      a.group.visible = extra && extra.visible === false ? false : true;
      return a;
    },

    remove: function (id) {
      var a = this.avatars[id];
      if (!a) return;
      this.scene.remove(a.group);
      a.group.traverse(function (node) {
        if (node.isMesh) {
          var mats = Array.isArray(node.material) ? node.material : [node.material];
          mats.forEach(function (m) { if (m && m.dispose) m.dispose(); });
        }
        if (node.isSprite && node.material) {
          if (node.material.map) node.material.map.dispose();
          node.material.dispose();
        }
      });
      delete this.avatars[id];
    },

    /** Drop anyone not in the given id list. Call after each sync pass. */
    keepOnly: function (ids) {
      var keep = {};
      ids.forEach(function (id) { keep[id] = true; });
      for (var id in this.avatars) {
        if (!keep[id]) this.remove(id);
      }
    },

    clear: function () {
      for (var id in this.avatars) this.remove(id);
    },

    /**
     * Where a player's head is on screen, or null when they're behind the
     * camera or off frame. Used to pin chat bubbles to people.
     */
    screenPos: function (id, lift) {
      var a = this.avatars[id];
      if (!a || !a.group.visible) return null;
      var THREE = this.THREE;
      var v = new THREE.Vector3();
      a.group.getWorldPosition(v);
      v.y += lift == null ? this.height * 1.7 : lift;
      v.project(this.camera);
      if (v.z > 1) return null; // behind the camera
      if (v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) return null;
      return {
        x: (v.x * 0.5 + 0.5) * window.innerWidth,
        y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      };
    },
  };

  global.MPThree = {
    create: function (opts) {
      return new Avatars(opts);
    },
  };
})(window);
