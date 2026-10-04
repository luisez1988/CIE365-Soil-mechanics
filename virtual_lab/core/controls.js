/* VLab.Controls — build a control panel from a declarative schema.
   Item types:
     {type:'heading', label}
     {type:'range',  key, label, min, max, step, value, unit, digits}
     {type:'select', key, label, options:[[value,label],...], value}
     {type:'toggle', key, label, value}
     {type:'number', key, label, value, step}
     {type:'buttons', items:[{label, onClick, id}]}
     {type:'html', id}                     an empty slot the experiment fills
   Labels are trusted HTML from the experiment's own schema (for <sub> etc.).
   Any item may carry visibleIf(state) -> bool.
   onChange(state, key) fires on every user edit.

   VLab.Hash keeps a flat {key: value} object in location.hash so a deck can
   deep-link a preset: .../index.html#hu=42&left=noflow */
(function (VLab) {
  'use strict';

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function html(tag, cls, markup) {
    var e = el(tag, cls);
    e.innerHTML = markup;
    return e;
  }

  function fmt(v, digits) { return digits == null ? String(v) : Number(v).toFixed(digits); }

  function Controls(container, schema, onChange, initial) {
    var state = {}, rows = [], inputs = {}, self = this;
    initial = initial || {};

    schema.forEach(function (it) {
      if (it.key) {
        var v = initial[it.key] != null ? initial[it.key] : it.value;
        if (it.type === 'range' || it.type === 'number') {
          v = Number(v);
          if (!isFinite(v)) v = it.value;
          if (it.type === 'range') v = Math.min(it.max, Math.max(it.min, v));
        } else if (it.type === 'toggle') {
          v = v === true || v === 'true' || v === '1' || v === 1;
        } else if (it.type === 'select') {
          var ok = it.options.some(function (o) { return String(o[0]) === String(v); });
          if (!ok) v = it.value;
        }
        state[it.key] = v;
      }
    });

    function changed(key) {
      refresh();
      if (onChange) onChange(state, key);
    }

    schema.forEach(function (it) {
      var row;
      if (it.type === 'heading') {
        row = el('h3', 'vl-heading', it.label);
      } else if (it.type === 'range') {
        row = el('label', 'vl-row vl-range');
        var top = el('span', 'vl-label');
        top.appendChild(html('span', null, it.label));
        var out = el('output', 'vl-value');
        top.appendChild(out);
        var inp = el('input');
        inp.type = 'range'; inp.min = it.min; inp.max = it.max; inp.step = it.step || 1;
        inp.value = state[it.key];
        var show = function () { out.textContent = fmt(state[it.key], it.digits) + (it.unit ? ' ' + it.unit : ''); };
        inp.addEventListener('input', function () { state[it.key] = Number(inp.value); show(); changed(it.key); });
        row.appendChild(top); row.appendChild(inp);
        inputs[it.key] = { set: function (v) { inp.value = v; show(); } };
        show();
      } else if (it.type === 'select') {
        row = el('label', 'vl-row vl-select');
        row.appendChild(html('span', 'vl-label', it.label));
        var sel = el('select');
        it.options.forEach(function (o) {
          var op = el('option', null, o[1]);
          op.value = o[0];
          sel.appendChild(op);
        });
        sel.value = state[it.key];
        sel.addEventListener('change', function () { state[it.key] = sel.value; changed(it.key); });
        row.appendChild(sel);
        inputs[it.key] = { set: function (v) { sel.value = v; } };
      } else if (it.type === 'toggle') {
        row = el('label', 'vl-row vl-toggle');
        var cb = el('input');
        cb.type = 'checkbox'; cb.checked = state[it.key];
        cb.addEventListener('change', function () { state[it.key] = cb.checked; changed(it.key); });
        row.appendChild(cb);
        row.appendChild(html('span', 'vl-label', it.label));
        inputs[it.key] = { set: function (v) { cb.checked = !!v; } };
      } else if (it.type === 'number') {
        row = el('label', 'vl-row vl-number');
        row.appendChild(html('span', 'vl-label', it.label));
        var num = el('input');
        num.type = 'number'; num.step = it.step || 'any'; num.value = state[it.key];
        num.addEventListener('change', function () {
          var v = Number(num.value);
          if (isFinite(v) && v > 0) { state[it.key] = v; changed(it.key); } else num.value = state[it.key];
        });
        row.appendChild(num);
        inputs[it.key] = { set: function (v) { num.value = v; } };
      } else if (it.type === 'buttons') {
        row = el('div', 'vl-row vl-buttons');
        it.items.forEach(function (b) {
          var btn = el('button', 'vl-btn', b.label);
          btn.type = 'button';
          if (b.id) btn.id = b.id;
          btn.addEventListener('click', b.onClick);
          row.appendChild(btn);
        });
      } else if (it.type === 'html') {
        row = el('div', 'vl-slot');
        if (it.id) row.id = it.id;
      }
      if (row) {
        container.appendChild(row);
        rows.push({ it: it, row: row });
      }
    });

    function refresh() {
      rows.forEach(function (r) {
        if (r.it.visibleIf) r.row.style.display = r.it.visibleIf(state) ? '' : 'none';
      });
    }
    refresh();

    this.state = state;
    this.set = function (key, v) {
      state[key] = v;
      if (inputs[key]) inputs[key].set(v);
      refresh();
    };
    this.refresh = refresh;
  }

  var Hash = {
    read: function () {
      var o = {}, s = location.hash.replace(/^#/, '');
      if (!s) return o;
      s.split('&').forEach(function (p) {
        var kv = p.split('=');
        if (kv[0]) o[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
      });
      return o;
    },
    write: function (o) {
      var s = Object.keys(o).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(o[k]);
      }).join('&');
      try { history.replaceState(null, '', '#' + s); } catch (e) { /* sandboxed iframe */ }
    }
  };

  VLab.Controls = Controls;
  VLab.Hash = Hash;
  VLab.el = el;
})(window.VLab = window.VLab || {});
