import {test} from 'node:test';
import assert from 'node:assert/strict';
import {postgresRows} from '../lib/server/storage';

test('Postgres billing integers preserve numeric checks, unfulfilled state and reset arithmetic',()=>{
  const [order]=postgresRows([{amount:'69900',fulfilled:'0',created:'1791648000000',id:'12345'}],[{name:'amount',dataTypeID:20},{name:'fulfilled',dataTypeID:20},{name:'created',dataTypeID:20},{name:'id',dataTypeID:25}]);
  assert.equal(Math.round(699*100),order.amount);
  assert.equal(Boolean(order.fulfilled),false);
  assert.equal(order.created+30*86400000,1794240000000);
  assert.equal(order.id,'12345');
});
test('Postgres conversion preserves null and integers outside the safe numeric range',()=>{
  const rows=postgresRows([{value:null},{value:'9007199254740993'}],[{name:'value',dataTypeID:20}]);
  assert.deepEqual(rows,[{value:null},{value:'9007199254740993'}]);
});
