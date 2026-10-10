import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatBillingDate,formatPrice} from '../components/cloud/presentation';
test('billing presentation never invents missing dates or amounts',()=>{
  for(const value of [undefined,null,'',0,NaN,'bad date'])assert.equal(formatBillingDate(value),'Date unavailable');
  for(const amount of [undefined,null,NaN,-1,'69900'])assert.equal(formatPrice(amount),'Amount unavailable');
  assert.equal(formatPrice(0),'₹0.00');assert.equal(formatPrice(69900),'₹699.00');
  assert.notEqual(formatBillingDate(1791590400000),'Date unavailable');
});
test('invalid currency fails gracefully instead of breaking transaction history',()=>{assert.equal(formatPrice(100,'not-a-currency'),'Amount unavailable');});
