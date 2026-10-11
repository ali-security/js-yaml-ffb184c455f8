'use strict';


var assert = require('assert');
var fs     = require('fs');
var path   = require('path');
var yaml   = require('../../');

// The published tarball ships dist/ (see package.json "files"): `import
// 'js-yaml'` resolves to dist/js-yaml.mjs and unpkg/jsDelivr serve
// dist/js-yaml.min.js, so the !!omap resolver has to be fixed through the
// bundles too, not only through the CommonJS entry point.
var min = require('../../dist/js-yaml.min.js');


// A well-formed !!omap of `count` distinct single-pair mappings. Resolving it
// has to check every key against the ones already seen; with a linear scan per
// key that check alone is quadratic in `count`.
function createOmap(count) {
  var lines = [ '--- !!omap' ];
  var i;

  for (i = 0; i < count; i++) {
    lines.push('- k' + i + ': ' + i);
  }

  return lines.join('\n') + '\n';
}


// The same payload without the !!omap tag: identical parsing work, but no
// duplicate-key resolution. Used as a per-machine speed baseline so the
// assertion below measures the resolver's complexity rather than the runner.
function createPlainSequence(count) {
  var lines = [ '---' ];
  var i;

  for (i = 0; i < count; i++) {
    lines.push('- k' + i + ': ' + i);
  }

  return lines.join('\n') + '\n';
}


function fastest(fn) {
  var best = Infinity;
  var start, elapsed, i;

  for (i = 0; i < 2; i++) {
    start = process.hrtime();
    fn();
    elapsed = process.hrtime(start);
    best = Math.min(best, elapsed[0] * 1e3 + elapsed[1] / 1e6);
  }

  return best;
}


// Resolving the tagged document may cost a bit more than the untagged one, but
// not a multiple of it. Unpatched this ratio is 15-30x at COUNT and keeps
// growing with the document; patched it stays near 1.
var COUNT = 40000;
var MAX_OVERHEAD_RATIO = 5;


function assertOmapResolvesLinearly(loader) {
  var tagged = createOmap(COUNT);
  var plain  = createPlainSequence(COUNT);

  // warm the parser up so the first measured run is not paying for JIT
  loader.load(createOmap(1000));
  loader.load(createPlainSequence(1000));

  var baseline = fastest(function () { loader.load(plain); });
  var omap     = fastest(function () { loader.load(tagged); });
  var ratio    = omap / baseline;

  assert.ok(ratio < MAX_OVERHEAD_RATIO,
    'resolving a ' + COUNT + '-entry !!omap took ' + omap.toFixed(0) + 'ms vs ' +
    baseline.toFixed(0) + 'ms untagged (ratio ' + ratio.toFixed(1) + ', expected < ' +
    MAX_OVERHEAD_RATIO + ') - the duplicate-key check is not constant time');
}


describe('Pathological tests', function () {
  describe('!!omap resolution', function () {
    this.timeout(60000);

    it('resolves a large !!omap without quadratic slowdown', function () {
      assertOmapResolvesLinearly(yaml);
    });

    it('dist/js-yaml.min.js resolves a large !!omap without quadratic slowdown', function () {
      assertOmapResolvesLinearly(min);
    });

    // The unminified bundles keep the resolver readable, so assert on the
    // shape of the fix directly - a cheap, timing-independent guard that the
    // bundles were regenerated from the patched lib/.
    it('dist/js-yaml.js and dist/js-yaml.mjs carry the constant-time key check', function () {
      [ 'js-yaml.js', 'js-yaml.mjs' ].forEach(function (name) {
        var src = fs.readFileSync(path.resolve(__dirname, '../../dist', name), 'utf8');

        assert.strictEqual(src.indexOf('objectKeys.indexOf'), -1,
          name + ' still scans seen !!omap keys with indexOf()');
        assert.notStrictEqual(src.indexOf('Object.defineProperty(objectKeys, pairKey'), -1,
          name + ' does not record seen !!omap keys on a lookup object');
      });
    });

    // Speeding the check up must not weaken it: the resolver still rejects a
    // repeated key, and keys that collide with Object.prototype members are
    // handled by own-property lookups rather than inherited ones.
    it('still rejects duplicate keys, including inherited-property names', function () {
      [ 'a', '__proto__', 'hasOwnProperty', 'toString', 'constructor' ].forEach(function (key) {
        assert.throws(function () {
          yaml.load('--- !!omap\n- ' + key + ': 1\n- ' + key + ': 2\n');
        }, yaml.YAMLException, 'duplicate ' + key + ' key was accepted');
      });
    });

    it('accepts distinct keys that shadow Object.prototype members', function () {
      var loaded = yaml.load('--- !!omap\n- __proto__: 1\n- hasOwnProperty: 2\n- toString: 3\n');

      assert.strictEqual(loaded.length, 3);
      assert.strictEqual(Object.keys(loaded[0])[0], '__proto__');
      assert.strictEqual(loaded[1].hasOwnProperty, 2);
      assert.strictEqual(loaded[2].toString, 3);
    });
  });
});
