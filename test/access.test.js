const test = require('node:test');
const assert = require('node:assert');
const { isCourtesyActive, ACTIVE_BUSINESS_SQL } = require('../services/access');

test('cortesía vigente: sin vencimiento o con fecha futura', () => {
  const day = 24 * 60 * 60 * 1000;
  assert.ok(isCourtesyActive('courtesy', null));
  assert.ok(isCourtesyActive('courtesy', new Date(Date.now() + day).toISOString()));
  assert.ok(!isCourtesyActive('courtesy', new Date(Date.now() - day).toISOString()));
  assert.ok(!isCourtesyActive('active', null));
  assert.ok(!isCourtesyActive('trial', null));
});

test('SQL de negocio activo incluye cortesía con courtesy_until del negocio', () => {
  const sql = ACTIVE_BUSINESS_SQL('b');
  assert.match(sql, /o\.plan = 'courtesy' AND \(b\.courtesy_until IS NULL OR b\.courtesy_until > NOW\(\)\)/);
  assert.match(sql, /o\.plan = 'active'/);
  assert.match(sql, /o\.trial_ends_at > NOW\(\)/);
  assert.match(sql, /o\.access_until > NOW\(\)/);
});
