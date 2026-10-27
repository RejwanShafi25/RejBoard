const test = require('node:test');
const assert = require('node:assert');
const S = require('../schema-core.js');

const SQL = `
-- shop schema
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE, /* login */
  name text,
  created_at timestamp with time zone DEFAULT now()
);
CREATE TABLE "orders" (
  id bigint NOT NULL,
  customer_id integer NOT NULL REFERENCES customers(id),
  total NUMERIC(10, 2) DEFAULT 0,
  note text DEFAULT 'it''s; fine',
  CONSTRAINT orders_pk PRIMARY KEY (id)
);
CREATE TABLE \`order_items\` (
  \`order_id\` bigint,
  \`product_id\` int,
  qty INT NOT NULL,
  PRIMARY KEY (order_id, product_id),
  KEY idx_p (product_id)
) ENGINE=InnoDB;
CREATE TABLE products (id int primary key, sku varchar(40));
ALTER TABLE order_items ADD CONSTRAINT fk1 FOREIGN KEY (order_id) REFERENCES orders (id);
ALTER TABLE order_items ADD FOREIGN KEY (product_id) REFERENCES products;
`;

test('SQL: tables, types, keys and references', () => {
  const m = S.parseSQL(SQL);
  assert.deepStrictEqual(m.tables.map(t => t.name), ['customers', 'orders', 'order_items', 'products']);
  const c = m.tables[0].columns;
  assert.deepStrictEqual(c.map(x => x.name), ['id', 'email', 'name', 'created_at']);
  assert.strictEqual(c[1].type, 'VARCHAR(255)');
  assert.ok(c[0].pk && c[1].nn && c[1].uq && !c[2].nn);
  assert.strictEqual(c[3].type, 'timestamp with time zone');
  assert.strictEqual(c[3].def, 'now()');
  const o = m.tables[1].columns;
  assert.strictEqual(o[2].type, 'NUMERIC(10,2)');
  assert.strictEqual(o[3].def, "'it''s; fine'");
  assert.ok(o[0].pk, 'table-level primary key');
  const oi = m.tables[2].columns;
  assert.ok(oi[0].pk && oi[1].pk && !oi[2].pk, 'composite key');
  assert.deepStrictEqual(m.refs.map(r => `${r.from.table}.${r.from.column}>${r.to.table}.${r.to.column}`).sort(),
    ['order_items.order_id>orders.id', 'order_items.product_id>products.id', 'orders.customer_id>customers.id']);
  assert.ok(o[1].fk && oi[0].fk && oi[1].fk);
  assert.deepStrictEqual(m.refs.map(r => r.kind), ['n1', 'n1', 'n1'], 'part of a composite key is still many-to-one');
  assert.strictEqual(S.parseSQL('create table a (id int primary key); create table b (id int primary key references a(id));').refs[0].kind, '11');
  assert.deepStrictEqual(m.errors, []);
});

test('SQL round trip keeps the schema', () => {
  const a = S.parseSQL(SQL), b = S.parseSQL(S.toSQL(a));
  const sig = m => JSON.stringify({ t: m.tables.map(t => [t.name, t.columns.map(c => [c.name, c.type.toLowerCase(), c.pk, c.nn, c.uq, c.fk])]), r: m.refs });
  assert.strictEqual(sig(b), sig(a));
  assert.match(S.toSQL(a), /ALTER TABLE order_items ADD FOREIGN KEY \(order_id\) REFERENCES orders \(id\);/);
  assert.match(S.toSQL(a), /PRIMARY KEY \(order_id, product_id\)/);
});

test('SQL: reserved and odd names are quoted, junk is tolerated', () => {
  const m = S.parseSQL('create table user (id int primary key, "first name" text); create table; drop table x; select 1;');
  assert.strictEqual(m.tables.length, 1);
  assert.strictEqual(m.tables[0].columns[1].name, 'first name');
  const out = S.toSQL(m);
  assert.match(out, /CREATE TABLE "user"/);
  assert.match(out, /"first name" text/);
  assert.ok(m.errors.length >= 1);
  assert.deepStrictEqual(S.parseSQL('').tables, []);
  assert.deepStrictEqual(S.parseSQL('CREATE TABLE a (b int REFERENCES missing(id));').refs, []);
});

const DBML = `
// blog
Project blog { database_type: 'PostgreSQL' }
Table users as U {
  id integer [pk, increment]
  username varchar [not null, unique]
  role "user role" [default: 'reader', note: 'who, they are']
  created_at timestamp [default: \`now()\`]
}
Table posts {
  id integer [primary key]
  title varchar(200) [not null]
  user_id integer [not null, ref: > users.id]
  Note: 'a post'
}
Table post_tags {
  post_id int
  tag_id int
  indexes {
    (post_id, tag_id) [pk]
    tag_id [name: 'by tag']
  }
}
Table tags { id int [pk] }
Ref: post_tags.post_id > posts.id
Ref tag_ref { tags.id < post_tags.tag_id }
Ref: users.id - profiles.user_id
Enum role { admin reader }
`;

test('DBML: tables, settings, indexes and every kind of ref', () => {
  assert.strictEqual(S.detect(DBML), 'dbml');
  assert.strictEqual(S.detect(SQL), 'sql');
  const m = S.parse(DBML);
  assert.deepStrictEqual(m.tables.map(t => t.name), ['users', 'posts', 'post_tags', 'tags']);
  const u = m.tables[0].columns;
  assert.ok(u[0].pk && u[1].nn && u[1].uq);
  assert.strictEqual(u[2].type, 'user role');
  assert.strictEqual(u[2].def, "'reader'");
  assert.strictEqual(u[3].def, 'now()');
  assert.strictEqual(m.tables[1].columns[1].type, 'varchar(200)');
  const pt = m.tables[2].columns;
  assert.ok(pt[0].pk && pt[1].pk);
  const refs = m.refs.map(r => `${r.from.table}.${r.from.column}>${r.to.table}.${r.to.column}:${r.kind}`).sort();
  assert.deepStrictEqual(refs, ['post_tags.post_id>posts.id:n1', 'post_tags.tag_id>tags.id:n1', 'posts.user_id>users.id:n1']);
  assert.ok(m.errors.some(e => /profiles/.test(e)), 'unknown table reported');
});

test('DBML round trip, and SQL -> DBML -> SQL', () => {
  const a = S.parseDBML(DBML), b = S.parseDBML(S.toDBML(a));
  const sig = m => JSON.stringify({ t: m.tables.map(t => [t.name, t.columns.map(c => [c.name, c.type, c.pk, c.nn, c.uq, c.fk])]), r: m.refs });
  assert.strictEqual(sig(b), sig(a));
  const s = S.parseSQL(SQL), d = S.parseDBML(S.toDBML(s));
  assert.deepStrictEqual(d.tables.map(t => t.name), s.tables.map(t => t.name));
  assert.strictEqual(d.refs.length, s.refs.length);
  assert.match(S.toDBML(s), /Table order_items \{[\s\S]*indexes \{\n    \(order_id, product_id\) \[pk\]/);
});

test('board labels round trip and connector guesses', () => {
  const m = S.parseSQL(SQL);
  for (const t of m.tables) {
    const back = S.parseTableLabel(S.tableLabel(t));
    assert.strictEqual(back.name, t.name);
    assert.deepStrictEqual(back.columns.map(c => [c.name, c.type, c.pk, c.fk, c.nn, c.uq]), t.columns.map(c => [c.name, c.type, c.pk, c.fk, c.nn, c.uq]));
  }
  assert.strictEqual(S.tableLabel(m.tables[1]).split('\n')[2], 'customer_id integer FK NN');
  const lab = S.parseTableLabel('orders\nid INT PK\ncustomer_id INT NOT NULL\n--\n');
  assert.ok(lab.columns[1].nn && lab.columns.length === 2);
  const cust = S.parseTableLabel('customers\nid INT PK'), ord = S.parseTableLabel('orders\nid INT PK\ncustomer_id INT');
  assert.deepStrictEqual(S.guessRef(cust, ord), { from: { table: 'orders', column: 'customer_id' }, to: { table: 'customers', column: 'id' }, kind: 'n1' });
  assert.strictEqual(S.guessRef(cust, S.parseTableLabel('x\nid INT PK')), null);
  assert.deepStrictEqual(S.ends({ kind: 'n1' }, { nn: true }), ['zmany', 'only']);
  assert.deepStrictEqual(S.ends({ kind: '11' }), ['zone', 'only']);
});

test('limits hold on huge or hostile input', () => {
  const big = Array.from({ length: 400 }, (_, k) => `CREATE TABLE t${k} (id int);`).join('\n');
  assert.strictEqual(S.parseSQL(big).tables.length, S.LIM.tables);
  assert.doesNotThrow(() => S.parseSQL('CREATE TABLE a ((((((('));
  assert.doesNotThrow(() => S.parseDBML('Table a { b int [ref: > ] }\nRef: > \nTable {'));
  assert.doesNotThrow(() => S.parse('x'.repeat(300000)));
});
