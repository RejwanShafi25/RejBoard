const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const I = require('../interop-core.js');

const CLASS = `@startuml
' a comment
skinparam monochrome true
left to right direction
abstract class Animal {
  - name : String
  + speak() : void
}
class Dog
interface Pet
Animal <|-- Dog
Pet <|.. Dog
Owner "1" o-- "*" Dog : owns >
Dog *-- Tail
Dog ..> Food : eats
Dog : + fetch()
note right of Dog : good boy
@enduml`;

test('PlantUML class diagram: classes, members and every relation', () => {
  const m = I.parsePlantUML(CLASS);
  assert.strictEqual(m.kind, 'graph');
  assert.strictEqual(m.dir, 'LR');
  const ids = m.nodes.map(n => n.id);
  assert.deepStrictEqual(ids.sort(), ['Animal', 'Dog', 'Food', 'Owner', 'Pet', 'Tail']);
  const a = m.nodes.find(n => n.id === 'Animal'), d = m.nodes.find(n => n.id === 'Dog'), p = m.nodes.find(n => n.id === 'Pet');
  assert.deepStrictEqual(a.members, ['- name : String', '+ speak() : void']);
  assert.deepStrictEqual(d.members, ['+ fetch()']);
  assert.strictEqual(p.type, 'interface');
  const e = k => m.edges.find(x => x.from + '>' + x.to === k);
  assert.strictEqual(e('Animal>Dog').ah0, 'htri');
  assert.ok(e('Pet>Dog').dashed && e('Pet>Dog').ah0 === 'htri');
  const own = e('Owner>Dog');
  assert.deepStrictEqual([own.ah0, own.m0, own.m1, own.label], ['hdiamond', '1', '*', 'owns']);
  assert.strictEqual(e('Dog>Tail').ah0, 'diamond');
  assert.ok(e('Dog>Food').dashed && e('Dog>Food').ah1 === 'arrow' && e('Dog>Food').label === 'eats');
  assert.deepStrictEqual(m.errors, []);
});

test('PlantUML use case and component shortcuts', () => {
  const m = I.parsePlantUML(`@startuml
actor Customer
actor :Admin: as A
usecase "Place order" as UC1
Customer --> (Browse catalog)
Customer --> UC1
A -> [Inventory service]
[Inventory service] ..> [Database] : reads
package Shop {
  component Cart
}
@enduml`);
  assert.strictEqual(m.kind, 'graph');
  const t = id => (m.nodes.find(n => n.id === id) || {}).type;
  assert.strictEqual(t('Customer'), 'actor');
  assert.strictEqual(t('A'), 'actor');
  assert.strictEqual(m.nodes.find(n => n.id === 'UC1').label, 'Place order');
  assert.strictEqual(t('Browse catalog'), 'usecase');
  assert.strictEqual(t('Inventory service'), 'component');
  assert.strictEqual(t('Cart'), 'component');
  assert.ok(!m.nodes.some(n => n.id === 'Shop'), 'packages are not drawn');
  assert.strictEqual(m.edges.length, 4);
});

test('PlantUML sequence diagram', () => {
  const m = I.parsePlantUML(`@startuml
actor User
participant "Web app" as W
database DB
User -> W : sign in
activate W
W -> DB : find user
DB --> W : row
alt wrong password
  W --> User : error
else
  W --> User : welcome
end
@enduml`);
  assert.strictEqual(m.kind, 'sequence');
  assert.deepStrictEqual(m.participants.map(p => [p.id, p.label, p.type]), [['User', 'User', 'actor'], ['W', 'Web app', 'participant'], ['DB', 'DB', 'database']]);
  assert.deepStrictEqual(m.messages.map(g => `${g.from}>${g.to}:${g.label}:${g.dashed ? 'd' : 's'}`), ['User>W:sign in:s', 'W>DB:find user:s', 'DB>W:row:d', 'W>User:error:d', 'W>User:welcome:d']);
  /* without participant lines, plain messages still make a sequence */
  assert.strictEqual(I.parsePlantUML('Alice -> Bob : hello\nBob --> Alice : hi').kind, 'sequence');
});

test('PlantUML out and back in', () => {
  const a = I.parsePlantUML(CLASS), txt = I.toPlantUML(a), b = I.parsePlantUML(txt);
  assert.match(txt, /^@startuml\nleft to right direction\n/);
  assert.match(txt, /Owner "1" o-- "\*" Dog : owns/);
  assert.strictEqual(b.nodes.length, a.nodes.length);
  assert.deepStrictEqual(b.edges.map(e => [e.from, e.to, e.ah0, e.ah1, e.dashed]), a.edges.map(e => [e.from, e.to, e.ah0, e.ah1, e.dashed]));
  const s = I.parsePlantUML('participant A\nA -> B : x\nB --> A : y'), back = I.parsePlantUML(I.toPlantUML(s));
  assert.deepStrictEqual(back.messages, s.messages);
});

test('PlantUML junk is skipped, not fatal', () => {
  const m = I.parsePlantUML('hello there\n-->\nA --> B\n%%%');
  assert.strictEqual(m.nodes.length, 2);
  assert.ok(m.errors.length >= 1);
  assert.doesNotThrow(() => I.parsePlantUML('x'.repeat(3000000)));
});

const MODEL = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="a" value="Start &amp; go" style="strokeWidth=2;html=1;shape=mxgraph.flowchart.terminator;whiteSpace=wrap;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>
<mxCell id="b" value="Ok?" style="rhombus;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="40" y="160" width="120" height="80" as="geometry"/></mxCell>
<UserObject label="&lt;b&gt;Store&lt;/b&gt;&lt;br&gt;orders" id="c"><mxCell style="shape=cylinder3;whiteSpace=wrap;html=1;dashed=1;" vertex="1" parent="1"><mxGeometry x="260" y="160" width="80" height="90" as="geometry"/></mxCell></UserObject>
<mxCell id="g" value="Group" style="swimlane;" vertex="1" parent="1"><mxGeometry x="400" y="40" width="200" height="200" as="geometry"/></mxCell>
<mxCell id="d" value="Inside" style="ellipse;" vertex="1" parent="g"><mxGeometry x="20" y="40" width="80" height="40" as="geometry"/></mxCell>
<mxCell id="k" value="User" style="swimlane;fontStyle=1;childLayout=stackLayout;horizontal=1;" vertex="1" parent="1"><mxGeometry x="40" y="300" width="160" height="100" as="geometry"/></mxCell>
<mxCell id="k1" value="+ name: String" style="text;" vertex="1" parent="k"><mxGeometry y="26" width="160" height="26" as="geometry"/></mxCell>
<mxCell id="k2" value="" style="line;" vertex="1" parent="k"><mxGeometry y="52" width="160" height="8" as="geometry"/></mxCell>
<mxCell id="k3" value="+ login()" style="text;" vertex="1" parent="k"><mxGeometry y="60" width="160" height="26" as="geometry"/></mxCell>
<mxCell id="e1" value="" style="edgeStyle=orthogonalEdgeStyle;endArrow=block;endFill=0;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>
<mxCell id="e1l" value="next" style="edgeLabel;" vertex="1" connectable="0" parent="e1"><mxGeometry x="-0.2" relative="1" as="geometry"/></mxCell>
<mxCell id="e2" value="yes" style="endArrow=ERzeroToMany;startArrow=ERmandOne;dashed=1;" edge="1" parent="1" source="b" target="c"><mxGeometry relative="1" as="geometry"/></mxCell>
<mxCell id="e3" style="endArrow=none;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"><mxPoint x="10" y="10" as="sourcePoint"/><mxPoint x="90" y="10" as="targetPoint"/><Array as="points"><mxPoint x="50" y="30"/></Array></mxGeometry></mxCell>
<mxCell id="t" value="A note" style="text;html=1;" vertex="1" parent="1"><mxGeometry x="300" y="320" width="100" height="30" as="geometry"/></mxCell>
</root></mxGraphModel>`;
const FILE = `<mxfile host="app.diagrams.net"><diagram name="Main" id="x">${MODEL}</diagram></mxfile>`;

test('draw.io: shapes, styles, groups, classes and edges', () => {
  const r = I.parseDrawio(FILE);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.pages.length, 1);
  const p = r.pages[0], n = id => p.nodes.find(q => q.id === id), e = id => p.edges.find(q => q.id === id);
  assert.deepStrictEqual([n('a').kind, n('a').label, n('a').fill, n('a').stroke, n('a').sw], ['term', 'Start & go', '#dae8fc', '#6c8ebf', 2]);
  assert.strictEqual(n('b').kind, 'dia');
  assert.deepStrictEqual([n('c').kind, n('c').label, n('c').dashed], ['cyl', 'Store\norders', true]);
  assert.deepStrictEqual([n('g').kind, n('d').kind, n('d').x, n('d').y], ['frame', 'ell', 420, 80], 'children placed relative to their container');
  assert.deepStrictEqual([n('k').kind, n('k').label], ['class', 'User\n+ name: String\n--\n+ login()']);
  assert.ok(!n('k1') && !n('e1l'), 'rows and edge labels are folded in');
  assert.strictEqual(n('t').kind, 'text');
  assert.deepStrictEqual([e('e1').source, e('e1').target, e('e1').orth, e('e1').ah1, e('e1').label], ['a', 'b', true, 'htri', 'next']);
  assert.deepStrictEqual([e('e2').ah0, e('e2').ah1, e('e2').dashed, e('e2').label], ['only', 'zmany', true, 'yes']);
  assert.deepStrictEqual([e('e3').source, e('e3').sp, e('e3').tp, e('e3').points, e('e3').ah1], [null, [10, 10], [90, 10], [[50, 30]], 'none']);
});

test('draw.io: compressed pages and bare models', () => {
  const comp = zlib.deflateRawSync(Buffer.from(encodeURIComponent(MODEL))).toString('base64');
  const file = `<mxfile><diagram name="P1">${comp}</diagram><diagram name="P2">${MODEL}</diagram></mxfile>`;
  const inflate = u => new Uint8Array(zlib.inflateRawSync(Buffer.from(u)));
  const r = I.parseDrawio(file, inflate);
  assert.deepStrictEqual(r.pages.map(p => [p.name, p.nodes.length]), [['P1', 7], ['P2', 7]]);
  assert.ok(I.parseDrawio(file).errors.some(x => /Compressed/.test(x)), 'without an inflater the compressed page is reported');
  assert.strictEqual(I.parseDrawio(MODEL).pages[0].nodes.length, 7);
  assert.ok(I.parseDrawio('<html>nope</html>').errors.length);
});

test('draw.io out and back in', () => {
  const m = { nodes: [{ id: 'n1', kind: 'term', x: 10, y: 20, w: 120, h: 50, label: 'Start <now>', fill: '#ffffff', stroke: '#000000', sw: 2 },
    { id: 'n2', kind: 'rect', x: 10, y: 120, w: 160, h: 90, label: 'User\n+ name\n--\n+ login()', comp: true },
    { id: 'n3', kind: 'cyl', x: 220, y: 120, w: 80, h: 90, label: 'DB', dashed: true }],
  edges: [{ id: 'l1', source: 'n1', target: 'n2', label: 'go', ah0: 'none', ah1: 'tri', orth: true }, { id: 'l2', source: 'n2', target: 'n3', ah0: 'only', ah1: 'zmany', dashed: true },
    { id: 'l3', sp: [0, 0], tp: [50, 50], ah0: 'hdiamond', ah1: 'arrow' }] };
  const xml = I.toDrawio(m, 'Board & co');
  assert.match(xml, /^<mxfile host="RejBoard"/);
  assert.match(xml, /name="Board &amp; co"/);
  const p = I.parseDrawio(xml).pages[0], n = id => p.nodes.find(q => q.id === 'rb-' + id), e = id => p.edges.find(q => q.id === 'rb-' + id);
  assert.deepStrictEqual([n('n1').kind, n('n1').label, n('n1').sw], ['term', 'Start <now>', 2]);
  assert.strictEqual(n('n2').label, 'User\n--\n+ name\n--\n+ login()');
  assert.deepStrictEqual([n('n3').kind, n('n3').dashed], ['cyl', true]);
  assert.deepStrictEqual([e('l1').ah1, e('l1').orth, e('l1').label, e('l1').source], ['tri', true, 'go', 'rb-n1']);
  assert.deepStrictEqual([e('l2').ah0, e('l2').ah1, e('l2').dashed], ['only', 'zmany', true]);
  assert.deepStrictEqual([e('l3').ah0, e('l3').sp, e('l3').tp], ['hdiamond', [0, 0], [50, 50]]);
});

test('draw.io style helpers', () => {
  assert.strictEqual(I.kindOf(I.style('ellipse;whiteSpace=wrap;')), 'ell');
  assert.strictEqual(I.kindOf(I.style('rounded=1;whiteSpace=wrap;')), 'btask');
  assert.strictEqual(I.kindOf(I.style('shape=umlActor;')), 'uactor');
  assert.strictEqual(I.kindOf(I.style('whiteSpace=wrap;html=1;')), 'rect');
  assert.strictEqual(I.plain('a<br>b&nbsp;c<div>d</div>'), 'a\nb c\nd');
});
