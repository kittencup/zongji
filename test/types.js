var SETTINGS = require('./settings/mysql');
var querySequence = require('./helpers/querySequence');
var expectEvents = require('./helpers/expectEvents');

var ZongJi = require('./../');
var mysql = require('mysql');

var eventLog = [];
var zongji, db, esc, escId;

var checkTableMatches = function(tableName){
  return function(test, event){
    var tableDetails = event.tableMap[event.tableId]; 
    test.strictEqual(tableDetails.parentSchema, SETTINGS.database);
    test.strictEqual(tableDetails.tableName, tableName);
  };
};

// For use with expectEvents()
var tableMapEvent = function(tableName){
  return {
    _type: 'TableMap',
    tableName: tableName,
    schemaName: SETTINGS.database
  };
};

module.exports = {
  setUp: function(done){
    if(db) return done(); // Only connect on first setUp
    db = mysql.createConnection(SETTINGS.connection);
    esc = db.escape.bind(db);
    escId = db.escapeId;

    // Perform initialization queries sequentially
    querySequence(db, [
      'DROP DATABASE IF EXISTS ' + escId(SETTINGS.database),
      'CREATE DATABASE ' + escId(SETTINGS.database),
      'USE ' + escId(SETTINGS.database),
      'RESET MASTER',
    ], function(){
      zongji = new ZongJi(SETTINGS.connection);

      zongji.on('binlog', function(evt) {
        eventLog.push(evt);
      });

      zongji.start({
        filter: ['tablemap', 'writerows', 'updaterows', 'deleterows']
      });

      done();
    });
  },
  tearDown: function(done){
    eventLog.splice(0, eventLog.length);
    done();
  },
  testTypeSet: function(test){
    var testTable = 'type_set';
    querySequence(db, [
      'DROP TABLE IF EXISTS ' + escId(testTable),
      'CREATE TABLE ' + escId(testTable) + ' (col SET(' +
         '"a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", ' +
         '"n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z"));',
      'INSERT INTO ' + escId(testTable) + ' (col) VALUES ' +
        '("a,d"), ("d,a,b"), ("a,d,i,z"), ("a,j,d"), ("d,a,p")'
    ], function(){
      expectEvents(test, eventLog, [
        tableMapEvent(testTable),
        {
          _type: 'WriteRows',
          _checkTableMap: checkTableMatches(testTable),
          rows: [
            { col: [ 'a', 'd' ] },
            { col: [ 'a', 'b', 'd' ] },
            { col: [ 'a', 'd', 'i', 'z' ] },
            { col: [ 'a', 'd', 'j' ] },
            { col: [ 'a', 'd', 'p' ] }
          ]
        }
      ]);
      test.done();
    });
  },
  testTypeDouble: function(test){
    var testTable = 'type_double';
    querySequence(db, [
      'DROP TABLE IF EXISTS ' + escId(testTable),
      'CREATE TABLE ' + escId(testTable) + ' (col DOUBLE NULL)',
      'INSERT INTO ' + escId(testTable) + ' (col) VALUES ' +
        '(1.0), (-1.0), (123.456), (-13.47),' +
        '(44441231231231231223999.123), (-44441231231231231223999.123)'
    ], function(){
      expectEvents(test, eventLog, [
        tableMapEvent(testTable),
        {
          _type: 'WriteRows',
          _checkTableMap: checkTableMatches(testTable),
          rows: [
            { col: 1 },
            { col: -1 },
            { col: 123.456 },
            { col: -13.47 },
            { col: 44441231231231231223999.123 }, // > 2^32
            { col: -44441231231231231223999.123 }
          ]
        }
      ]);
      test.done();
    });
  },
  testTypeFloat: function(test){
    console.log(' ');
    var testTable = 'type_float';
    querySequence(db, [
      'DROP TABLE IF EXISTS ' + escId(testTable),
      'CREATE TABLE ' + escId(testTable) + ' (col FLOAT NULL)',
      'INSERT INTO ' + escId(testTable) + ' (col) VALUES ' +
        '(1.0), (-1.0), (123.456), (-13.47), (3999.123)'
    ], function(){
      expectEvents(test, eventLog, [
        tableMapEvent(testTable),
        {
          _type: 'WriteRows',
          _checkTableMap: checkTableMatches(testTable),
          _fuzzy: function(test, event){
            // Ensure sum of differences is very low
            var rowsExp = [ 1, -1, 123.456, -13.47, 3999.123 ];
            var diff = event.rows.reduce(function(prev, cur, index){
              return prev + Math.abs(cur.col - rowsExp[index]);
            }, 0);
            test.ok(diff < 0.0001);
          }
        }
      ]);
      test.done();
    });
  }
}
