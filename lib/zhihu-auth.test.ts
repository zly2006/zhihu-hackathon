import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalLoginUrlFor} from './oauth-origin';

test('local OAuth login redirects to the registered callback origin before starting authorization',()=>{
  assert.equal(canonicalLoginUrlFor('https://restart-life.example/auth/callback','http://127.0.0.1:3000')?.toString(),'https://restart-life.example/api/auth/login');
});

test('OAuth login already on the callback origin does not redirect to itself',()=>{
  assert.equal(canonicalLoginUrlFor('https://restart-life.example/auth/callback','https://restart-life.example'),null);
});
