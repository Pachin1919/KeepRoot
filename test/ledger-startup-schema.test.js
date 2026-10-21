import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {Ledger, LATEST_SCHEMA_VERSION} from '../src/ledger.js';

test('Opening a current schema does not run historical backfills or DDL again', () => {
  fs.mkdirSync('test/.tmp',{recursive:true});
  const stateDir=fs.mkdtempSync(path.resolve('test/.tmp/ledger-startup-schema-'));
  const initial=new Ledger(stateDir); initial.close();
  const exec=DatabaseSync.prototype.exec;
  const sql=[];
  DatabaseSync.prototype.exec=function(query){sql.push(query);return exec.call(this,query);};
  let current;
  try {
    current=new Ledger(stateDir);
    assert.equal(current.db.prepare('PRAGMA user_version').get().user_version,LATEST_SCHEMA_VERSION);
    assert.ok(current.projects && current.resources && current.boards, 'Current repositories remain available');
    assert.equal(sql.filter(query=>/UPDATE artifacts|CREATE TABLE|ALTER TABLE/u.test(query)).length,0,
      'A completed migration must not turn every application launch into a table-wide backfill');
  } finally {
    DatabaseSync.prototype.exec=exec; current?.close(); fs.rmSync(stateDir,{recursive:true,force:true});
  }
});
