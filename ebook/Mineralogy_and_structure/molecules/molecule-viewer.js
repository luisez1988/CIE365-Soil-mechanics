/* ==========================================================================
   molecule-viewer.js — shared driver for the ebook's 3-D clay-mineral models.

   Ported from the slide-deck viewers (Mineralogy_and_structure/molecules/)
   and reworked for a scrolling, light-background page:
     * one config-driven script instead of two near-identical copies;
     * a perspective camera framed from the model size, refitted on resize;
     * zoom through camera.zoom (the slide version moved an orthographic
       camera along z, which does not change an orthographic projection);
     * wheel zoom only with Ctrl/Cmd/Shift, and `touch-action: pan-y` on the
       canvas, so the page still scrolls past the embed;
     * rendering only when something changed and the embed is on screen.

   Usage: initMoleculeViewer({...}) — see the two *_model.html files.
   ========================================================================== */
(function (global) {
  'use strict';

  var ROT_SPEED = 0.008;        // radians per pixel dragged
  var AUTO_SPEED = 0.005;       // radians per frame while auto-rotating
  var ZOOM_MIN = 0.55, ZOOM_MAX = 4;

  function makeLabelSprite(text, colorHex) {
    var pad = 12, font = 'bold 64px Roboto, "Segoe UI", Arial, sans-serif';
    var measure = document.createElement('canvas').getContext('2d');
    measure.font = font;
    var w = Math.ceil(measure.measureText(text).width) + pad * 2;
    var h = 64 + pad * 2;

    var canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';   // halo, so text reads on any atom
    ctx.strokeText(text, w / 2, h / 2);
    ctx.fillStyle = colorHex;
    ctx.fillText(text, w / 2, h / 2);

    var texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    var sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    }));
    var height = 0.85;
    sprite.scale.set(height * (w / h), height, 1);
    sprite.renderOrder = 10;
    return sprite;
  }

  function hex(n) { return '#' + ('000000' + n.toString(16)).slice(-6); }

  global.initMoleculeViewer = function (cfg) {
    var viewer = document.getElementById('viewer');

    if (typeof THREE === 'undefined') { document.body.classList.add('no-webgl'); return; }

    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch (err) {
      document.body.classList.add('no-webgl');
      return;
    }
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    viewer.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('tabindex', '0');
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute('aria-label',
      cfg.title + ' - interactive 3-D model. Drag to rotate.');

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(cfg.background || 0xfdfdfb);

    var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);

    scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    var key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(10, 10, 10);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-10, -10, -10);
    scene.add(fill);

    // ---- geometry -------------------------------------------------------
    var group = new THREE.Group();
    scene.add(group);

    var bonds = new THREE.Group();
    var wireframe = new THREE.Group();
    var labels = new THREE.Group();
    labels.visible = false;

    var centerMat = new THREE.MeshPhongMaterial({
      color: cfg.center.color, shininess: 100, specular: 0x111111
    });
    var vertexMat = new THREE.MeshPhongMaterial({
      color: cfg.vertex.color, shininess: 80, specular: 0x111111
    });
    var bondMat = new THREE.MeshPhongMaterial({ color: 0x228b22, shininess: 50 });

    group.add(new THREE.Mesh(
      new THREE.SphereGeometry(cfg.center.radius, 32, 32), centerMat
    ));

    var vertexGeo = new THREE.SphereGeometry(cfg.vertex.radius, 32, 32);
    var radius = cfg.center.radius;

    cfg.positions.forEach(function (p) {
      var pos = new THREE.Vector3(p[0], p[1], p[2]);
      var atom = new THREE.Mesh(vertexGeo, vertexMat);
      atom.position.copy(pos);
      group.add(atom);

      var length = pos.length();
      radius = Math.max(radius, length + cfg.vertex.radius);

      var bond = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.1, length, 8), bondMat
      );
      bond.position.copy(pos).multiplyScalar(0.5);
      bond.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0), pos.clone().normalize()
      );
      bonds.add(bond);

      var label = makeLabelSprite(cfg.vertex.label, hex(cfg.vertex.color));
      label.position.copy(pos).multiplyScalar(
        1 + (cfg.vertex.radius + 0.45) / length
      );
      labels.add(label);
    });

    var centerLabel = makeLabelSprite(cfg.center.label, hex(cfg.center.color));
    centerLabel.position.set(0, cfg.center.radius + 0.5, 0);
    labels.add(centerLabel);

    var edgeMat = new THREE.LineBasicMaterial({
      color: 0x666666, transparent: true, opacity: 0.35
    });
    cfg.edges.forEach(function (pair) {
      var a = cfg.positions[pair[0]], b = cfg.positions[pair[1]];
      wireframe.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(a[0], a[1], a[2]),
          new THREE.Vector3(b[0], b[1], b[2])
        ]), edgeMat));
    });

    group.add(bonds);
    group.add(wireframe);
    group.add(labels);

    // ---- camera framing --------------------------------------------------
    // extra margin keeps the model clear of the legend and the control bar
    var fitRadius = radius * 1.3;
    var viewDir = new THREE.Vector3(0, 0.22, 1).normalize();

    function frame() {
      var w = viewer.clientWidth || 1, h = viewer.clientHeight || 1;
      var aspect = w / h;
      renderer.setSize(w, h, false);
      camera.aspect = aspect;

      var halfV = THREE.MathUtils.degToRad(camera.fov) / 2;
      var dist = fitRadius / Math.tan(halfV);
      // portrait embeds run out of width first, so fit the horizontal FOV
      if (aspect < 1) dist = fitRadius / (Math.tan(halfV) * aspect);

      camera.position.copy(viewDir).multiplyScalar(dist);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      invalidate();
    }

    // ---- render loop (on demand) ----------------------------------------
    var dirty = true, autoRotate = false, onScreen = true;
    function invalidate() { dirty = true; }

    function animate() {
      requestAnimationFrame(animate);
      if (!onScreen) return;
      if (autoRotate) {
        group.rotateOnWorldAxis(Y_AXIS, AUTO_SPEED);
        dirty = true;
      }
      if (!dirty) return;
      dirty = false;
      renderer.render(scene, camera);
    }

    // ---- interaction -----------------------------------------------------
    var X_AXIS = new THREE.Vector3(1, 0, 0), Y_AXIS = new THREE.Vector3(0, 1, 0);

    function rotateBy(dx, dy) {
      group.rotateOnWorldAxis(Y_AXIS, dx * ROT_SPEED);
      group.rotateOnWorldAxis(X_AXIS, dy * ROT_SPEED);
      invalidate();
    }

    function zoomBy(factor) {
      camera.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, camera.zoom * factor));
      camera.updateProjectionMatrix();
      invalidate();
    }

    var pointers = new Map(), last = null, pinchDist = 0;
    var canvas = renderer.domElement;

    function spread() {
      var pts = Array.from(pointers.values());
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }

    canvas.addEventListener('pointerdown', function (e) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers */ }
      if (pointers.size === 1) {
        last = { x: e.clientX, y: e.clientY };
        viewer.classList.add('dragging');
        setAutoRotate(false);
      } else if (pointers.size === 2) {
        pinchDist = spread();
      }
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size >= 2) {
        var d = spread();
        if (pinchDist > 0 && d > 0) zoomBy(d / pinchDist);
        pinchDist = d;
        return;
      }
      if (!last) return;
      rotateBy(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
    });

    function endPointer(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (pointers.size === 0) {
        last = null;
        viewer.classList.remove('dragging');
      }
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('lostpointercapture', endPointer);

    // A plain wheel is left to the page, so the chapter keeps scrolling.
    canvas.addEventListener('wheel', function (e) {
      if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    }, { passive: false });

    canvas.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 24 : 8;
      switch (e.key) {
        case 'ArrowLeft':  rotateBy(-step, 0); break;
        case 'ArrowRight': rotateBy(step, 0); break;
        case 'ArrowUp':    rotateBy(0, -step); break;
        case 'ArrowDown':  rotateBy(0, step); break;
        case '+': case '=': zoomBy(1.12); break;
        case '-': case '_': zoomBy(1 / 1.12); break;
        default: return;
      }
      setAutoRotate(false);
      e.preventDefault();
    });

    // ---- buttons ---------------------------------------------------------
    function toggleButton(id, target) {
      var btn = document.getElementById(id);
      btn.setAttribute('aria-pressed', String(target.visible));
      btn.addEventListener('click', function () {
        target.visible = !target.visible;
        btn.setAttribute('aria-pressed', String(target.visible));
        invalidate();
      });
    }
    toggleButton('bondsBtn', bonds);
    toggleButton('edgesBtn', wireframe);
    toggleButton('labelsBtn', labels);

    var rotateBtn = document.getElementById('rotateBtn');
    function setAutoRotate(on) {
      if (autoRotate === on) return;
      autoRotate = on;
      rotateBtn.setAttribute('aria-pressed', String(on));
      rotateBtn.textContent = on ? 'Stop rotation' : 'Auto rotate';
      invalidate();
    }
    rotateBtn.addEventListener('click', function () { setAutoRotate(!autoRotate); });

    document.getElementById('resetBtn').addEventListener('click', function () {
      group.quaternion.identity();
      camera.zoom = 1;
      setAutoRotate(false);
      frame();
    });

    // ---- lifecycle -------------------------------------------------------
    if (global.ResizeObserver) {
      new ResizeObserver(frame).observe(viewer);
    } else {
      global.addEventListener('resize', frame);
    }

    if (global.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        if (onScreen) invalidate();
      }, { rootMargin: '120px' }).observe(viewer);
    }

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) invalidate();
    });

    frame();
    animate();
  };
})(window);
