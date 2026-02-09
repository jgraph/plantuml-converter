/**
 * Test suite for the PlantUML-to-draw.io converter.
 * Run with: node --experimental-vm-modules test.js
 */

import { convert, extractPlantUml, regenerate, detectDiagramType } from './PlantUmlImporter.js';
import { parseArrow, parseStyle } from './diagrams/sequence/ArrowParser.js';
import { parseSequenceDiagram } from './diagrams/sequence/SequenceParser.js';
import {
	ArrowHead, ArrowBody, ArrowPart, ArrowDecoration,
	Message, ExoMessage, LifeEvent, Fragment, Note, Divider, Delay, HSpace, Reference, Box,
	LifeEventType, GroupingType, NotePosition, NoteStyle
} from './diagrams/sequence/SequenceModel.js';
import { parseClassDiagram } from './diagrams/class/ClassParser.js';
import { emitClassDiagram } from './diagrams/class/ClassEmitter.js';
import {
	EntityType, Visibility, MemberType, RelationDecor, LineStyle, Direction,
	NotePosition as ClassNotePosition, SeparatorStyle, JsonNodeType,
	ClassEntity, Member, Separator, Relationship, Package, Note as ClassNote,
	MapEntry, JsonNode, ClassDiagram
} from './diagrams/class/ClassModel.js';
import { parseUsecaseDiagram } from './diagrams/usecase/UsecaseParser.js';
import { emitUsecaseDiagram } from './diagrams/usecase/UsecaseEmitter.js';
import {
	ElementType as UCElementType, RelationDecor as UCRelationDecor,
	LineStyle as UCLineStyle, Direction as UCDirection,
	NotePosition as UCNotePosition, DiagramDirection,
	UsecaseElement, UsecaseRelationship, UsecaseContainer, UsecaseNote, UsecaseDiagram
} from './diagrams/usecase/UsecaseModel.js';
import { parseActivityDiagram } from './diagrams/activity/ActivityParser.js';
import { emitActivityDiagram } from './diagrams/activity/ActivityEmitter.js';
import {
	InstructionType, NotePosition as ActNotePosition,
	Instruction, SwimlaneDefinition, ActivityDiagram
} from './diagrams/activity/ActivityModel.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
	if (condition) {
		passed++;
	} else {
		failed++;
		console.error(`  FAIL: ${message}`);
	}
}

function section(name) {
	console.log(`\n── ${name} ──`);
}

// ── Arrow Parser Tests ───────────────────────────────────────────────────

section('Arrow Parser');

{
	const a = parseArrow('->');
	assert(a.head1 === ArrowHead.NONE, '-> head1 should be NONE');
	assert(a.head2 === ArrowHead.NORMAL, '-> head2 should be NORMAL');
	assert(a.body === ArrowBody.NORMAL, '-> body should be NORMAL');
	console.log('  -> : OK');
}

{
	const a = parseArrow('-->');
	assert(a.head2 === ArrowHead.NORMAL, '--> head2 should be NORMAL');
	assert(a.body === ArrowBody.DOTTED, '--> body should be DOTTED');
	console.log('  --> : OK');
}

{
	const a = parseArrow('->>');
	assert(a.head2 === ArrowHead.ASYNC, '->> head2 should be ASYNC');
	assert(a.body === ArrowBody.NORMAL, '->> body should be NORMAL');
	console.log('  ->> : OK');
}

{
	const a = parseArrow('-->>');
	assert(a.head2 === ArrowHead.ASYNC, '-->> head2 should be ASYNC');
	assert(a.body === ArrowBody.DOTTED, '-->> body should be DOTTED');
	console.log('  -->> : OK');
}

{
	const a = parseArrow('<-');
	assert(a.head1 === ArrowHead.NORMAL, '<- head1 should be NORMAL');
	console.log('  <- : OK');
}

{
	const a = parseArrow('<->');
	assert(a.head1 === ArrowHead.NORMAL, '<-> head1 should be NORMAL');
	assert(a.head2 === ArrowHead.NORMAL, '<-> head2 should be NORMAL');
	console.log('  <-> : OK');
}

{
	const a = parseArrow('->x');
	assert(a.head2 === ArrowHead.CROSSX, '->x head2 should be CROSSX');
	console.log('  ->x : OK');
}

{
	const a = parseArrow('o->');
	assert(a.decoration1 === ArrowDecoration.CIRCLE, 'o-> decoration1 should be CIRCLE');
	console.log('  o-> : OK');
}

{
	const a = parseArrow('o->o');
	assert(a.decoration1 === ArrowDecoration.CIRCLE, 'o->o decoration1 should be CIRCLE');
	assert(a.decoration2 === ArrowDecoration.CIRCLE, 'o->o decoration2 should be CIRCLE');
	console.log('  o->o : OK');
}

{
	const s = parseStyle('#red');
	assert(s.color === '#red', 'parseStyle #red');
	console.log('  parseStyle #red : OK');
}

{
	const s = parseStyle('dashed');
	assert(s.lineStyle === 'dashed', 'parseStyle dashed');
	console.log('  parseStyle dashed : OK');
}

// ── Sequence Parser Tests ────────────────────────────────────────────────

section('Sequence Parser');

// Basic participants
{
	const d = parseSequenceDiagram(`
@startuml
participant Alice
actor Bob
database DB
@enduml
`);
	assert(d.participants.size === 3, 'Should have 3 participants');
	assert(d.participants.get('Alice').type === 'participant', 'Alice is participant');
	assert(d.participants.get('Bob').type === 'actor', 'Bob is actor');
	assert(d.participants.get('DB').type === 'database', 'DB is database');
	console.log('  Basic participants: OK');
}

// Participant with alias
{
	const d = parseSequenceDiagram(`
@startuml
participant "User Interface" as UI
actor "Admin User" as Admin
@enduml
`);
	assert(d.participants.has('UI'), 'Should have UI participant');
	assert(d.participants.get('UI').displayName === 'User Interface', 'UI display name');
	assert(d.participants.get('Admin').displayName === 'Admin User', 'Admin display name');
	console.log('  Participant aliases: OK');
}

// Simple messages
{
	const d = parseSequenceDiagram(`
@startuml
Alice -> Bob : hello
Bob --> Alice : response
@enduml
`);
	assert(d.elements.length === 2, 'Should have 2 messages');
	const m1 = d.elements[0];
	assert(m1 instanceof Message, 'First element is Message');
	assert(m1.from === 'Alice', 'msg1 from Alice');
	assert(m1.to === 'Bob', 'msg1 to Bob');
	assert(m1.label === 'hello', 'msg1 label');
	const m2 = d.elements[1];
	assert(m2.from === 'Bob', 'msg2 from Bob');
	assert(m2.label === 'response', 'msg2 label');
	console.log('  Simple messages: OK');
}

// Self message
{
	const d = parseSequenceDiagram(`
@startuml
Alice -> Alice : think
@enduml
`);
	const m = d.elements[0];
	assert(m.isSelf === true, 'Should be self message');
	console.log('  Self message: OK');
}

// Auto-declare participants
{
	const d = parseSequenceDiagram(`
@startuml
Alice -> Bob : hello
Bob -> Carol : forward
@enduml
`);
	assert(d.participants.size === 3, 'Should auto-declare 3 participants');
	assert(d.participants.has('Carol'), 'Carol auto-declared');
	console.log('  Auto-declare participants: OK');
}

// Inline activation
{
	const d = parseSequenceDiagram(`
@startuml
Alice -> Bob ++ : call
Bob --> Alice -- : return
@enduml
`);
	// Should have: Message, LifeEvent(activate Bob), Message, LifeEvent(deactivate Bob)
	assert(d.elements.length === 4, 'Should have 4 elements (2 messages + 2 life events)');
	assert(d.elements[1] instanceof LifeEvent, 'Second element is LifeEvent');
	assert(d.elements[1].type === LifeEventType.ACTIVATE, 'Should be ACTIVATE');
	assert(d.elements[3] instanceof LifeEvent, 'Fourth element is LifeEvent');
	assert(d.elements[3].type === LifeEventType.DEACTIVATE, 'Should be DEACTIVATE');
	console.log('  Inline activation: OK');
}

// Explicit activation
{
	const d = parseSequenceDiagram(`
@startuml
Alice -> Bob : call
activate Bob
Bob --> Alice : return
deactivate Bob
@enduml
`);
	assert(d.elements[1] instanceof LifeEvent, 'Should have activate event');
	assert(d.elements[1].type === LifeEventType.ACTIVATE, 'Should be ACTIVATE');
	assert(d.elements[3] instanceof LifeEvent, 'Should have deactivate event');
	console.log('  Explicit activation: OK');
}

// Divider
{
	const d = parseSequenceDiagram(`
@startuml
Alice -> Bob : before
== Phase 2 ==
Alice -> Bob : after
@enduml
`);
	assert(d.elements[1] instanceof Divider, 'Should have divider');
	assert(d.elements[1].label === 'Phase 2', 'Divider label');
	console.log('  Divider: OK');
}

// Delay
{
	const d = parseSequenceDiagram(`
@startuml
Alice -> Bob : msg1
... 5 minutes later ...
Alice -> Bob : msg2
@enduml
`);
	assert(d.elements[1] instanceof Delay, 'Should have delay');
	assert(d.elements[1].label.includes('5 minutes'), 'Delay label');
	console.log('  Delay: OK');
}

// Fragment (alt/else)
{
	const d = parseSequenceDiagram(`
@startuml
Alice -> Bob : request
alt success
  Bob -> Alice : ok
else failure
  Bob -> Alice : error
end
@enduml
`);
	// Elements: Message, Fragment
	assert(d.elements.length === 2, 'Should have 2 top-level elements');
	const frag = d.elements[1];
	assert(frag instanceof Fragment, 'Second element is Fragment');
	assert(frag.type === GroupingType.ALT, 'Fragment type is ALT');
	assert(frag.sections.length === 2, 'Should have 2 sections');
	assert(frag.sections[0].elements.length === 1, 'First section has 1 message');
	assert(frag.sections[1].elements.length === 1, 'Second section has 1 message');
	console.log('  Fragment (alt/else): OK');
}

// Nested fragments
{
	const d = parseSequenceDiagram(`
@startuml
loop 10 times
  Alice -> Bob : request
  alt success
    Bob -> Alice : ok
  else failure
    Bob -> Alice : error
  end
end
@enduml
`);
	const loop = d.elements[0];
	assert(loop instanceof Fragment, 'Top-level is Fragment');
	assert(loop.type === GroupingType.LOOP, 'Is LOOP');
	assert(loop.sections[0].elements.length === 2, 'Loop has 2 elements (msg + nested alt)');
	const alt = loop.sections[0].elements[1];
	assert(alt instanceof Fragment, 'Nested is Fragment');
	assert(alt.type === GroupingType.ALT, 'Nested is ALT');
	console.log('  Nested fragments: OK');
}

// Note on participant
{
	const d = parseSequenceDiagram(`
@startuml
participant Alice
note right of Alice : This is a note
@enduml
`);
	assert(d.elements[0] instanceof Note, 'Should have note');
	assert(d.elements[0].position === NotePosition.RIGHT, 'Note position RIGHT');
	assert(d.elements[0].text === 'This is a note', 'Note text');
	console.log('  Note on participant: OK');
}

// Multi-line note
{
	const d = parseSequenceDiagram(`
@startuml
participant Alice
note right of Alice
  Line 1
  Line 2
end note
@enduml
`);
	assert(d.elements[0] instanceof Note, 'Should have multi-line note');
	assert(d.elements[0].text.includes('Line 1'), 'Has line 1');
	assert(d.elements[0].text.includes('Line 2'), 'Has line 2');
	console.log('  Multi-line note: OK');
}

// Note over two participants
{
	const d = parseSequenceDiagram(`
@startuml
Alice -> Bob : hello
note over Alice, Bob
  Shared note
end note
@enduml
`);
	const note = d.elements[1];
	assert(note instanceof Note, 'Should have note');
	assert(note.participants.length === 2, 'Note over 2 participants');
	console.log('  Note over two participants: OK');
}

// Reference
{
	const d = parseSequenceDiagram(`
@startuml
ref over Alice, Bob : See other diagram
@enduml
`);
	assert(d.elements[0] instanceof Reference, 'Should have reference');
	assert(d.elements[0].text === 'See other diagram', 'Ref text');
	console.log('  Reference: OK');
}

// Box
{
	const d = parseSequenceDiagram(`
@startuml
box "Internal"
  participant Alice
  participant Bob
end box
participant Carol
@enduml
`);
	assert(d.boxes.length === 1, 'Should have 1 box');
	assert(d.boxes[0].title === 'Internal', 'Box title');
	assert(d.boxes[0].participants.length === 2, 'Box has 2 participants');
	console.log('  Box: OK');
}

// Title
{
	const d = parseSequenceDiagram(`
@startuml
title My Sequence Diagram
Alice -> Bob : hello
@enduml
`);
	assert(d.title === 'My Sequence Diagram', 'Diagram title');
	console.log('  Title: OK');
}

// Autonumber
{
	const d = parseSequenceDiagram(`
@startuml
autonumber
Alice -> Bob : hello
@enduml
`);
	assert(d.autoNumber !== null, 'Should have autonumber');
	assert(d.autoNumber.start === 1, 'Autonumber starts at 1');
	console.log('  Autonumber: OK');
}

// Destroy
{
	const d = parseSequenceDiagram(`
@startuml
Alice -> Bob : call
destroy Bob
@enduml
`);
	assert(d.elements[1] instanceof LifeEvent, 'Should have life event');
	assert(d.elements[1].type === LifeEventType.DESTROY, 'Should be DESTROY');
	console.log('  Destroy: OK');
}

// ── Full Pipeline Tests ──────────────────────────────────────────────────

section('Full Pipeline');

// Basic conversion
{
	const result = convert(`
@startuml
Alice -> Bob : hello
Bob --> Alice : world
@enduml
`);
	assert(result.xml.includes('<mxfile>'), 'Output contains mxfile');
	assert(result.xml.includes('plantUml='), 'Output contains plantUml attribute');
	assert(result.xml.includes('Alice'), 'Output contains Alice');
	assert(result.xml.includes('Bob'), 'Output contains Bob');
	assert(result.xml.includes('hello'), 'Output contains hello label');
	assert(result.diagramType === 'sequence', 'Diagram type is sequence');
	console.log('  Basic conversion: OK');
}

// Complex diagram
{
	const result = convert(`
@startuml
title Authentication Flow

participant "Web Client" as Client
participant "Auth Service" as Auth
database "User DB" as DB

Client -> Auth : login(user, pass)
activate Auth

Auth -> DB : findUser(user)
activate DB
DB --> Auth : userData
deactivate DB

alt valid credentials
  Auth -> Auth : generateToken()
  Auth --> Client : token
else invalid
  Auth --> Client : 401 Unauthorized
end

deactivate Auth

== Authenticated Requests ==

Client -> Auth : request + token
activate Auth
Auth -> Auth : validateToken()
Auth --> Client : response
deactivate Auth
@enduml
`);
	assert(result.xml.includes('<mxfile>'), 'Complex output contains mxfile');
	assert(result.xml.includes('Authentication Flow'), 'Contains title');
	assert(result.xml.includes('login(user, pass)'), 'Contains message label');
	assert(result.xml.includes('group;editable=0'), 'Group is non-editable');
	console.log('  Complex diagram: OK');
}

// Extract PlantUML from output
{
	const original = `@startuml
Alice -> Bob : hello
@enduml`;
	const result = convert(original);
	const extracted = extractPlantUml(result.xml);
	assert(extracted !== null, 'Should extract PlantUML');
	assert(extracted.includes('Alice -> Bob'), 'Extracted text contains arrow');
	console.log('  Extract PlantUML: OK');
}

// Regenerate
{
	const original = `@startuml
Alice -> Bob : hello
@enduml`;
	const result1 = convert(original);
	const result2 = regenerate(result1.xml);
	assert(result2.xml.includes('Alice'), 'Regenerated contains Alice');
	assert(result2.xml.includes('hello'), 'Regenerated contains hello');
	console.log('  Regenerate: OK');
}

// Regenerate with new PlantUML
{
	const original = `@startuml
Alice -> Bob : hello
@enduml`;
	const result1 = convert(original);
	const newText = `@startuml
Alice -> Carol : goodbye
@enduml`;
	const result2 = regenerate(result1.xml, newText);
	assert(result2.xml.includes('Carol'), 'Regenerated with new text contains Carol');
	assert(result2.xml.includes('goodbye'), 'Regenerated with new text contains goodbye');
	console.log('  Regenerate with new text: OK');
}

// Diagram type detection
{
	assert(detectDiagramType('Alice -> Bob : hello') === 'sequence', 'Detect sequence from arrow');
	assert(detectDiagramType('participant Foo') === 'sequence', 'Detect sequence from participant');
	console.log('  Type detection: OK');
}

// No-wrap mode
{
	const result = convert(`@startuml
Alice -> Bob : hello
@enduml`, { wrapInDocument: false, wrapInGroup: false });
	assert(!result.xml.includes('<mxfile>'), 'No mxfile wrapper');
	assert(!result.xml.includes('UserObject'), 'No UserObject wrapper');
	assert(result.xml.includes('Alice'), 'Still contains cells');
	console.log('  No-wrap mode: OK');
}

// ── Class Diagram Parser Tests ───────────────────────────────────────────

section('Class Parser');

{
	const d = parseClassDiagram('class Foo');
	assert(d.entities.has('Foo'), 'Simple class parsed');
	assert(d.entities.get('Foo').type === EntityType.CLASS, 'Type is CLASS');
	console.log('  Simple class: OK');
}

{
	const d = parseClassDiagram('interface Bar');
	assert(d.entities.has('Bar'), 'Interface parsed');
	assert(d.entities.get('Bar').type === EntityType.INTERFACE, 'Type is INTERFACE');
	console.log('  Interface: OK');
}

{
	const d = parseClassDiagram('enum Color');
	assert(d.entities.has('Color'), 'Enum parsed');
	assert(d.entities.get('Color').type === EntityType.ENUM, 'Type is ENUM');
	console.log('  Enum: OK');
}

{
	const d = parseClassDiagram('abstract class Shape');
	assert(d.entities.has('Shape'), 'Abstract class parsed');
	assert(d.entities.get('Shape').type === EntityType.ABSTRACT_CLASS, 'Type is ABSTRACT_CLASS');
	assert(d.entities.get('Shape').isAbstract === true, 'isAbstract is true');
	console.log('  Abstract class: OK');
}

{
	const d = parseClassDiagram('class "Display Name" as DN');
	assert(d.entities.has('DN'), 'Alias code parsed');
	assert(d.entities.get('DN').displayName === 'Display Name', 'Display name parsed');
	console.log('  Alias (quoted as): OK');
}

{
	const d = parseClassDiagram('class Box<T>');
	assert(d.entities.has('Box'), 'Generic class parsed');
	assert(d.entities.get('Box').genericParams === 'T', 'Generic param parsed');
	console.log('  Generics: OK');
}

{
	const d = parseClassDiagram('class Svc <<service>>');
	assert(d.entities.has('Svc'), 'Stereotyped class parsed');
	assert(d.entities.get('Svc').stereotypes[0] === 'service', 'Stereotype parsed');
	console.log('  Stereotype: OK');
}

{
	const d = parseClassDiagram('class Foo #LightBlue');
	assert(d.entities.has('Foo'), 'Colored class parsed');
	assert(d.entities.get('Foo').color === '#LightBlue', 'Color parsed');
	console.log('  Color: OK');
}

{
	const d = parseClassDiagram('class Foo extends Bar');
	assert(d.entities.has('Foo'), 'Class with extends parsed');
	assert(d.entities.get('Foo').extends[0] === 'Bar', 'Extends parsed');
	console.log('  Extends: OK');
}

{
	const d = parseClassDiagram(`class Foo {
	+name : String
	-age : int
	#weight : double
	~data : Object
}`);
	const entity = d.entities.get('Foo');
	assert(entity !== undefined, 'Class with body parsed');
	const members = entity.members.filter(m => !(m instanceof Separator));
	assert(members.length === 4, 'Four members parsed');
	assert(members[0].visibility === Visibility.PUBLIC, 'Public visibility');
	assert(members[1].visibility === Visibility.PRIVATE, 'Private visibility');
	assert(members[2].visibility === Visibility.PROTECTED, 'Protected visibility');
	assert(members[3].visibility === Visibility.PACKAGE, 'Package visibility');
	assert(members[0].name === 'name', 'Field name parsed');
	assert(members[0].returnType === 'String', 'Field type parsed');
	console.log('  Members with visibility: OK');
}

{
	const d = parseClassDiagram(`class Foo {
	+getName() : String
	-setAge(age : int) : void
}`);
	const entity = d.entities.get('Foo');
	const members = entity.members.filter(m => !(m instanceof Separator));
	assert(members[0].memberType === MemberType.METHOD, 'Method detected');
	assert(members[0].name === 'getName', 'Method name parsed');
	assert(members[0].parameters === '', 'Empty params parsed');
	assert(members[0].returnType === 'String', 'Return type parsed');
	assert(members[1].parameters === 'age : int', 'Params with type parsed');
	console.log('  Methods: OK');
}

{
	const d = parseClassDiagram(`class Foo {
	{static} +MAX : int
	{abstract} +compute() : void
}`);
	const entity = d.entities.get('Foo');
	const members = entity.members.filter(m => !(m instanceof Separator));
	assert(members[0].isStatic === true, 'Static detected');
	assert(members[1].isAbstract === true, 'Abstract detected');
	console.log('  Static/abstract members: OK');
}

{
	const d = parseClassDiagram(`class Foo {
	+field1 : String
	--
	+method1() : void
}`);
	const entity = d.entities.get('Foo');
	assert(entity.members.length === 3, 'Three items (field + separator + method)');
	assert(entity.members[1] instanceof Separator, 'Separator detected');
	assert(entity.members[1].style === SeparatorStyle.SOLID, 'Solid separator');
	console.log('  Separator: OK');
}

// ── Class Parser — Relationships ─────────────────────────────────────────

section('Class Parser — Relationships');

{
	const d = parseClassDiagram('A <|-- B');
	assert(d.links.length === 1, 'One relationship');
	assert(d.links[0].from === 'A', 'From is A');
	assert(d.links[0].to === 'B', 'To is B');
	assert(d.links[0].leftDecor === RelationDecor.EXTENDS, 'Left decor is EXTENDS');
	assert(d.links[0].lineStyle === LineStyle.SOLID, 'Line is solid');
	console.log('  Inheritance <|--: OK');
}

{
	const d = parseClassDiagram('A <|.. B');
	assert(d.links[0].leftDecor === RelationDecor.EXTENDS, 'Left decor is EXTENDS');
	assert(d.links[0].lineStyle === LineStyle.DASHED, 'Line is dashed');
	console.log('  Implementation <|..: OK');
}

{
	const d = parseClassDiagram('A *-- B');
	assert(d.links[0].leftDecor === RelationDecor.COMPOSITION, 'Left decor is COMPOSITION');
	console.log('  Composition *--: OK');
}

{
	const d = parseClassDiagram('A o-- B');
	assert(d.links[0].leftDecor === RelationDecor.AGGREGATION, 'Left decor is AGGREGATION');
	console.log('  Aggregation o--: OK');
}

{
	const d = parseClassDiagram('A --> B');
	assert(d.links[0].rightDecor === RelationDecor.ARROW, 'Right decor is ARROW');
	console.log('  Association -->: OK');
}

{
	const d = parseClassDiagram('A ..> B');
	assert(d.links[0].rightDecor === RelationDecor.ARROW, 'Right decor is ARROW');
	assert(d.links[0].lineStyle === LineStyle.DASHED, 'Line is dashed');
	console.log('  Dependency ..>: OK');
}

{
	const d = parseClassDiagram('A --> B : uses');
	assert(d.links[0].label === 'uses', 'Label parsed');
	console.log('  Link with label: OK');
}

{
	const d = parseClassDiagram('A "1" --> "*" B');
	assert(d.links[0].leftLabel === '1', 'Left cardinality');
	assert(d.links[0].rightLabel === '*', 'Right cardinality');
	console.log('  Cardinality: OK');
}

{
	const d = parseClassDiagram('A -[#red]-> B');
	assert(d.links[0].color === '#red', 'Link color parsed');
	console.log('  Link color: OK');
}

{
	const d = parseClassDiagram('A -- B');
	assert(d.links[0].leftDecor === RelationDecor.NONE, 'No left decor');
	assert(d.links[0].rightDecor === RelationDecor.NONE, 'No right decor');
	console.log('  Plain link --: OK');
}

// ── Class Parser — Packages ──────────────────────────────────────────────

section('Class Parser — Packages');

{
	const d = parseClassDiagram(`package com.example {
	class Foo
}`);
	assert(d.packages.length === 1, 'One package');
	assert(d.packages[0].name === 'com.example', 'Package name');
	assert(d.packages[0].entities.length === 1, 'One entity in package');
	assert(d.packages[0].entities[0] === 'Foo', 'Foo in package');
	console.log('  Simple package: OK');
}

{
	const d = parseClassDiagram(`package outer {
	package inner {
		class Bar
	}
}`);
	assert(d.packages[0].subPackages.length === 1, 'Nested package');
	assert(d.packages[0].subPackages[0].name === 'inner', 'Inner package name');
	assert(d.packages[0].subPackages[0].entities[0] === 'Bar', 'Bar in inner');
	console.log('  Nested packages: OK');
}

// ── Class Parser — Notes ─────────────────────────────────────────────────

section('Class Parser — Notes');

{
	const d = parseClassDiagram(`class Foo
note left of Foo : A note`);
	assert(d.notes.length === 1, 'One note');
	assert(d.notes[0].position === ClassNotePosition.LEFT, 'Note position is LEFT');
	assert(d.notes[0].entityCode === 'Foo', 'Note attached to Foo');
	assert(d.notes[0].text === 'A note', 'Note text');
	console.log('  Single-line note: OK');
}

{
	const d = parseClassDiagram(`class Foo
note left of Foo
	Line 1
	Line 2
end note`);
	assert(d.notes[0].text.includes('Line 1'), 'Multi-line note text');
	assert(d.notes[0].text.includes('Line 2'), 'Multi-line note text line 2');
	console.log('  Multi-line note: OK');
}

{
	const d = parseClassDiagram('note "Floating" as N1');
	assert(d.notes.length === 1, 'Floating note parsed');
	assert(d.notes[0].alias === 'N1', 'Note alias');
	assert(d.notes[0].text === 'Floating', 'Note text');
	console.log('  Floating note: OK');
}

{
	const d = parseClassDiagram(`class A
class B
A --> B
note on link : Link note`);
	assert(d.notes.length === 1, 'Note on link parsed');
	assert(d.notes[0].isOnLink === true, 'isOnLink is true');
	assert(d.notes[0].text === 'Link note', 'Note on link text');
	console.log('  Note on link: OK');
}

// ── Class Parser — Other ────────────────────────────────────────────────

section('Class Parser — Other');

{
	const d = parseClassDiagram(`class Foo
Foo : +aField : String
Foo : -aMethod() : void`);
	const entity = d.entities.get('Foo');
	assert(entity.members.length === 2, 'Two shorthand members');
	assert(entity.members[0].name === 'aField', 'Shorthand field name');
	assert(entity.members[1].memberType === MemberType.METHOD, 'Shorthand method detected');
	console.log('  Shorthand members: OK');
}

{
	const d = parseClassDiagram('<> diamond1');
	assert(d.entities.has('diamond1'), 'Diamond parsed');
	assert(d.entities.get('diamond1').type === EntityType.DIAMOND, 'Type is DIAMOND');
	console.log('  Diamond association: OK');
}

{
	const d = parseClassDiagram('() "API" as api');
	assert(d.entities.has('api'), 'Lollipop parsed');
	assert(d.entities.get('api').type === EntityType.LOLLIPOP_FULL, 'Type is LOLLIPOP_FULL');
	assert(d.entities.get('api').displayName === 'API', 'Lollipop display name');
	console.log('  Lollipop: OK');
}

{
	const d = parseClassDiagram('title My Title');
	assert(d.title === 'My Title', 'Title parsed');
	console.log('  Title: OK');
}

// ── Class Emitter Tests ─────────────────────────────────────────────────

section('Class Emitter');

{
	const d = parseClassDiagram(`class Foo {
	+name : String
	-age : int
}`);
	const cells = emitClassDiagram(d, 'parent-1');
	const xml = cells.join('\n');
	assert(xml.includes('swimlane'), 'Swimlane style used');
	assert(xml.includes('+ name'), 'Field name in output');
	assert(xml.includes('- age'), 'Private field in output');
	console.log('  Class box with members: OK');
}

{
	const d = parseClassDiagram(`class A
class B
A <|-- B`);
	const cells = emitClassDiagram(d, 'parent-1');
	const xml = cells.join('\n');
	assert(xml.includes('edge="1"'), 'Edge present');
	assert(xml.includes('endArrow=block') || xml.includes('startArrow=block'), 'Block arrow for extends');
	console.log('  Extends edge: OK');
}

{
	const d = parseClassDiagram(`class A
class B
A *-- B`);
	const cells = emitClassDiagram(d, 'parent-1');
	const xml = cells.join('\n');
	assert(xml.includes('startArrow=diamond'), 'Diamond arrow for composition');
	assert(xml.includes('startFill=1'), 'Filled diamond for composition');
	console.log('  Composition edge: OK');
}

{
	const d = parseClassDiagram(`class A
class B
A o-- B`);
	const cells = emitClassDiagram(d, 'parent-1');
	const xml = cells.join('\n');
	assert(xml.includes('startArrow=diamond'), 'Diamond arrow for aggregation');
	assert(xml.includes('startFill=0'), 'Hollow diamond for aggregation');
	console.log('  Aggregation edge: OK');
}

{
	const d = parseClassDiagram(`package test {
	class Foo
}`);
	const cells = emitClassDiagram(d, 'parent-1');
	const xml = cells.join('\n');
	assert(xml.includes('shape=folder'), 'Package uses folder shape');
	console.log('  Package rendering: OK');
}

{
	const d = parseClassDiagram(`class Foo
note left of Foo : A note`);
	const cells = emitClassDiagram(d, 'parent-1');
	const xml = cells.join('\n');
	assert(xml.includes('shape=note'), 'Note shape used');
	console.log('  Note rendering: OK');
}

// ── Class Pipeline Tests ────────────────────────────────────────────────

section('Class Pipeline');

{
	const result = convert(`@startuml
class Foo {
	+name : String
}
class Bar
Foo <|-- Bar
@enduml`);
	assert(result.diagramType === 'class', 'Detected as class diagram');
	assert(result.xml.includes('<mxfile>'), 'Has mxfile wrapper');
	assert(result.xml.includes('UserObject'), 'Has UserObject');
	assert(result.xml.includes('Foo'), 'Contains Foo');
	console.log('  Basic class conversion: OK');
}

{
	const type = detectDiagramType(`class Foo
class Bar
Foo <|-- Bar`);
	assert(type === 'class', 'Class diagram detected');
	console.log('  Class type detection: OK');
}

{
	const seqType = detectDiagramType(`Alice -> Bob : hello`);
	assert(seqType === 'sequence', 'Sequence still detected correctly');
	console.log('  Sequence type still works: OK');
}

// ── Usecase Parser Tests ─────────────────────────────────────────────────

section('Usecase Parser');

// Actor keyword
{
	const d = parseUsecaseDiagram('actor User');
	assert(d.elements.has('User'), 'Actor keyword creates element');
	assert(d.elements.get('User').type === UCElementType.ACTOR, 'Type is ACTOR');
	console.log('  Actor keyword: OK');
}

// Actor with alias
{
	const d = parseUsecaseDiagram('actor "System Admin" as Admin');
	assert(d.elements.has('Admin'), 'Actor alias code');
	assert(d.elements.get('Admin').displayName === 'System Admin', 'Actor display name');
	console.log('  Actor alias: OK');
}

// Actor shorthand
{
	const d = parseUsecaseDiagram(':Customer:');
	assert(d.elements.has('Customer'), 'Actor shorthand creates element');
	assert(d.elements.get('Customer').type === UCElementType.ACTOR, 'Shorthand type is ACTOR');
	console.log('  Actor shorthand: OK');
}

// Actor shorthand with spaces
{
	const d = parseUsecaseDiagram(':Guest User:');
	assert(d.elements.has('GuestUser'), 'Actor shorthand strips spaces for code');
	assert(d.elements.get('GuestUser').displayName === 'Guest User', 'Actor shorthand keeps display name');
	console.log('  Actor shorthand with spaces: OK');
}

// Business actor
{
	const d = parseUsecaseDiagram('actor/ "BA" as BA');
	assert(d.elements.has('BA'), 'Business actor parsed');
	assert(d.elements.get('BA').type === UCElementType.ACTOR_BUSINESS, 'Type is ACTOR_BUSINESS');
	console.log('  Business actor: OK');
}

// Business actor shorthand
{
	const d = parseUsecaseDiagram(':Manager:/');
	assert(d.elements.has('Manager'), 'Business actor shorthand');
	assert(d.elements.get('Manager').type === UCElementType.ACTOR_BUSINESS, 'Shorthand business type');
	console.log('  Business actor shorthand: OK');
}

// Usecase keyword
{
	const d = parseUsecaseDiagram('usecase "Place Order" as PlaceOrder');
	assert(d.elements.has('PlaceOrder'), 'Usecase keyword creates element');
	assert(d.elements.get('PlaceOrder').displayName === 'Place Order', 'Usecase display name');
	assert(d.elements.get('PlaceOrder').type === UCElementType.USECASE, 'Type is USECASE');
	console.log('  Usecase keyword: OK');
}

// Usecase keyword simple
{
	const d = parseUsecaseDiagram('usecase Login');
	assert(d.elements.has('Login'), 'Usecase simple keyword');
	assert(d.elements.get('Login').type === UCElementType.USECASE, 'Simple usecase type');
	console.log('  Usecase keyword simple: OK');
}

// Usecase shorthand
{
	const d = parseUsecaseDiagram('(Login System)');
	assert(d.elements.has('LoginSystem'), 'Usecase shorthand creates element');
	assert(d.elements.get('LoginSystem').displayName === 'Login System', 'Usecase shorthand display name');
	assert(d.elements.get('LoginSystem').type === UCElementType.USECASE, 'Shorthand type is USECASE');
	console.log('  Usecase shorthand: OK');
}

// Business usecase
{
	const d = parseUsecaseDiagram('usecase/ "Gen Report" as GenReport');
	assert(d.elements.has('GenReport'), 'Business usecase parsed');
	assert(d.elements.get('GenReport').type === UCElementType.USECASE_BUSINESS, 'Type is USECASE_BUSINESS');
	console.log('  Business usecase: OK');
}

// Business usecase shorthand
{
	const d = parseUsecaseDiagram('(Audit Trail)/');
	assert(d.elements.has('AuditTrail'), 'Business usecase shorthand');
	assert(d.elements.get('AuditTrail').type === UCElementType.USECASE_BUSINESS, 'Shorthand business usecase type');
	console.log('  Business usecase shorthand: OK');
}

// Stereotype
{
	const d = parseUsecaseDiagram('actor User <<External>>');
	assert(d.elements.get('User').stereotypes[0] === 'External', 'Actor stereotype');
	console.log('  Actor stereotype: OK');
}

// Color
{
	const d = parseUsecaseDiagram('actor VIP #LightBlue');
	assert(d.elements.get('VIP').color === '#LightBlue', 'Actor color');
	console.log('  Actor color: OK');
}

// Direction
{
	const d = parseUsecaseDiagram('left to right direction');
	assert(d.direction === DiagramDirection.LEFT_TO_RIGHT, 'Left-to-right direction');
	console.log('  Direction: OK');
}

// Title
{
	const d = parseUsecaseDiagram('title My Usecase Diagram');
	assert(d.title === 'My Usecase Diagram', 'Diagram title');
	console.log('  Title: OK');
}

// ── Usecase Parser — Containers ──────────────────────────────────────────

section('Usecase Parser — Containers');

{
	const d = parseUsecaseDiagram(`package "Online Store" {
	(Browse Products)
	(Place Order)
}`);
	assert(d.containers.length === 1, 'One container');
	assert(d.containers[0].name === 'Online Store', 'Container name');
	assert(d.containers[0].type === UCElementType.PACKAGE, 'Container type is PACKAGE');
	assert(d.containers[0].elements.length === 2, 'Two elements in container');
	console.log('  Package container: OK');
}

{
	const d = parseUsecaseDiagram(`rectangle "Payment" {
	(Validate Card)
}`);
	assert(d.containers[0].type === UCElementType.RECTANGLE, 'Container type is RECTANGLE');
	console.log('  Rectangle container: OK');
}

{
	const d = parseUsecaseDiagram(`package "Main" {
	package "Sub" {
		(Inner UC)
	}
}`);
	assert(d.containers[0].subContainers.length === 1, 'Nested container');
	assert(d.containers[0].subContainers[0].name === 'Sub', 'Nested name');
	assert(d.containers[0].subContainers[0].elements.length === 1, 'Nested element');
	console.log('  Nested containers: OK');
}

{
	const d = parseUsecaseDiagram(`package "Colored" #LightYellow {
	(UC1)
}`);
	assert(d.containers[0].color === '#LightYellow', 'Container color');
	console.log('  Container color: OK');
}

// ── Usecase Parser — Relationships ───────────────────────────────────────

section('Usecase Parser — Relationships');

{
	const d = parseUsecaseDiagram(`actor User
(Login)
User --> (Login)`);
	assert(d.links.length === 1, 'One relationship');
	assert(d.links[0].from === 'User', 'From is User');
	assert(d.links[0].to === 'Login', 'To is Login');
	assert(d.links[0].rightDecor === UCRelationDecor.ARROW, 'Right decor is ARROW');
	console.log('  Basic relationship: OK');
}

{
	const d = parseUsecaseDiagram(`:Customer: --> (Place Order)`);
	assert(d.links.length === 1, 'Shorthand link parsed');
	assert(d.links[0].from === 'Customer', 'From shorthand resolved');
	assert(d.links[0].to === 'PlaceOrder', 'To shorthand resolved');
	// Elements should be auto-created
	assert(d.elements.has('Customer'), 'Customer auto-created');
	assert(d.elements.has('PlaceOrder'), 'PlaceOrder auto-created');
	console.log('  Shorthand in links: OK');
}

{
	const d = parseUsecaseDiagram(`(A) ..> (B) : <<include>>`);
	assert(d.links[0].lineStyle === UCLineStyle.DASHED, 'Dashed line');
	assert(d.links[0].rightDecor === UCRelationDecor.ARROW, 'Arrow decor');
	assert(d.links[0].label === '<<include>>', 'Include label');
	console.log('  Include relationship: OK');
}

{
	const d = parseUsecaseDiagram(`actor A
actor B
A --|> B`);
	assert(d.links[0].rightDecor === UCRelationDecor.EXTENDS, 'Extends decorator');
	console.log('  Inheritance --|>: OK');
}

{
	const d = parseUsecaseDiagram(`:User: -down-> (UC1)`);
	assert(d.links[0].direction === UCDirection.DOWN, 'Direction hint DOWN');
	console.log('  Direction hint: OK');
}

{
	const d = parseUsecaseDiagram(`actor U
(UC)
U "1" --> "*" (UC) : places`);
	assert(d.links[0].leftLabel === '1', 'Left label');
	assert(d.links[0].rightLabel === '*', 'Right label');
	assert(d.links[0].label === 'places', 'Center label');
	console.log('  Link labels: OK');
}

{
	const d = parseUsecaseDiagram(`(A) -[#red]-> (B)`);
	assert(d.links[0].color === '#red', 'Link color');
	console.log('  Link color: OK');
}

{
	const d = parseUsecaseDiagram(`(A) ==> (B)`);
	assert(d.links[0].lineStyle === UCLineStyle.BOLD, 'Bold line style');
	console.log('  Bold link: OK');
}

// ── Usecase Parser — Notes ───────────────────────────────────────────────

section('Usecase Parser — Notes');

{
	const d = parseUsecaseDiagram(`actor User
note left of User : Primary user`);
	assert(d.notes.length === 1, 'One note');
	assert(d.notes[0].position === UCNotePosition.LEFT, 'Note position LEFT');
	assert(d.notes[0].entityCode === 'User', 'Note attached to User');
	assert(d.notes[0].text === 'Primary user', 'Note text');
	console.log('  Single-line note: OK');
}

{
	const d = parseUsecaseDiagram(`(Login)
note right of (Login)
	Line 1
	Line 2
end note`);
	assert(d.notes[0].text.includes('Line 1'), 'Multi-line note line 1');
	assert(d.notes[0].text.includes('Line 2'), 'Multi-line note line 2');
	console.log('  Multi-line note: OK');
}

{
	const d = parseUsecaseDiagram('note "Floating note" as N1');
	assert(d.notes[0].alias === 'N1', 'Floating note alias');
	assert(d.notes[0].text === 'Floating note', 'Floating note text');
	console.log('  Floating note: OK');
}

{
	const d = parseUsecaseDiagram(`(A) --> (B)
note on link : Link note`);
	assert(d.notes[0].isOnLink === true, 'Note on link');
	assert(d.notes[0].text === 'Link note', 'Note on link text');
	console.log('  Note on link: OK');
}

// ── Usecase Emitter Tests ────────────────────────────────────────────────

section('Usecase Emitter');

{
	const d = new UsecaseDiagram();
	const actor = new UsecaseElement('User', 'User', UCElementType.ACTOR);
	d.addElement(actor);
	const cells = emitUsecaseDiagram(d, 'parent-1');
	const xml = cells.join('\n');
	assert(cells.length > 0, 'Should emit actor cell');
	assert(xml.includes('shape=umlActor'), 'Should use umlActor shape');
	console.log('  Actor emission: OK');
}

{
	const d = new UsecaseDiagram();
	const uc = new UsecaseElement('Login', 'Login', UCElementType.USECASE);
	d.addElement(uc);
	const cells = emitUsecaseDiagram(d, 'parent-1');
	const xml = cells.join('\n');
	assert(cells.length > 0, 'Should emit usecase cell');
	assert(xml.includes('shape=ellipse'), 'Should use ellipse shape');
	console.log('  Usecase emission: OK');
}

{
	const d = parseUsecaseDiagram(`actor User
(Login)
User --> (Login)`);
	const cells = emitUsecaseDiagram(d, 'parent-1');
	const xml = cells.join('\n');
	assert(xml.includes('edge="1"'), 'Edge present');
	assert(xml.includes('endArrow=open'), 'Arrow for -->');
	console.log('  Edge emission: OK');
}

{
	const d = parseUsecaseDiagram(`package "System" {
	(UC1)
}`);
	const cells = emitUsecaseDiagram(d, 'parent-1');
	const xml = cells.join('\n');
	assert(xml.includes('container=1'), 'Container style');
	assert(xml.includes('shape=folder'), 'Package uses folder shape');
	console.log('  Container emission: OK');
}

{
	const d = parseUsecaseDiagram(`actor User
note left of User : A note`);
	const cells = emitUsecaseDiagram(d, 'parent-1');
	const xml = cells.join('\n');
	assert(xml.includes('shape=note'), 'Note shape');
	console.log('  Note emission: OK');
}

// ── Usecase Pipeline Tests ───────────────────────────────────────────────

section('Usecase Pipeline');

{
	const result = convert(`@startusecase
actor Customer
(Place Order)
Customer --> (Place Order)
@endusecase`);
	assert(result.diagramType === 'usecase', 'Detected as usecase diagram');
	assert(result.xml.includes('<mxfile>'), 'Has mxfile wrapper');
	assert(result.xml.includes('Customer'), 'Contains Customer');
	assert(result.xml.includes('Place Order'), 'Contains Place Order');
	console.log('  Basic usecase conversion: OK');
}

{
	const type = detectDiagramType(`@startusecase
actor User
(Login)
User --> (Login)
@endusecase`);
	assert(type === 'usecase', 'Usecase type detected via @startusecase');
	console.log('  Usecase type detection (@startusecase): OK');
}

{
	const type = detectDiagramType(`actor Customer
actor Admin
(Login)
(Place Order)
Customer --> (Login)
Admin --> (Place Order)`);
	assert(type === 'usecase', 'Usecase type detected via heuristic');
	console.log('  Usecase type detection (heuristic): OK');
}

{
	// Verify existing types still work
	const seqType = detectDiagramType('Alice -> Bob : hello');
	assert(seqType === 'sequence', 'Sequence still detected after usecase added');
	const classType = detectDiagramType(`class Foo
class Bar
Foo <|-- Bar`);
	assert(classType === 'class', 'Class still detected after usecase added');
	console.log('  Existing types still work: OK');
}

// ── Object Parser Tests ──────────────────────────────────────────────────

section('Object Parser');

{
	// Simple object
	const d = parseClassDiagram('object Foo');
	assert(d.entities.has('Foo'), 'Simple object parsed');
	assert(d.entities.get('Foo').type === EntityType.OBJECT, 'Type is OBJECT');
	console.log('  Simple object: OK');
}

{
	// Object with alias
	const d = parseClassDiagram('object "My Object" as MO');
	assert(d.entities.has('MO'), 'Object alias parsed');
	assert(d.entities.get('MO').displayName === 'My Object', 'Object display name');
	assert(d.entities.get('MO').type === EntityType.OBJECT, 'Aliased object type');
	console.log('  Object with alias: OK');
}

{
	// Object with body
	const d = parseClassDiagram(`object User {
	name = "Alice"
	age = 30
}`);
	const entity = d.entities.get('User');
	assert(entity !== undefined, 'Object with body exists');
	assert(entity.type === EntityType.OBJECT, 'Object body type');
	assert(entity.members.length === 2, 'Object body has 2 members');
	console.log('  Object with body: OK');
}

{
	// Object with stereotype and color
	const d = parseClassDiagram('object Svc <<singleton>> #LightBlue');
	const entity = d.entities.get('Svc');
	assert(entity !== undefined, 'Stereotyped object exists');
	assert(entity.stereotypes[0] === 'singleton', 'Object stereotype');
	assert(entity.color === '#LightBlue', 'Object color');
	console.log('  Object with stereotype and color: OK');
}

{
	// Links between objects
	const d = parseClassDiagram(`object A
object B
A --> B : knows`);
	assert(d.entities.has('A'), 'Object A exists');
	assert(d.entities.has('B'), 'Object B exists');
	assert(d.links.length === 1, 'One link between objects');
	assert(d.links[0].label === 'knows', 'Link label');
	console.log('  Links between objects: OK');
}

{
	// Note on object
	const d = parseClassDiagram(`object Server
note right of Server : Primary server`);
	assert(d.notes.length === 1, 'Note on object exists');
	assert(d.notes[0].entityCode === 'Server', 'Note attached to object');
	console.log('  Note on object: OK');
}

{
	// Object in package
	const d = parseClassDiagram(`package myPkg {
	object Inner {
		x = 1
	}
}`);
	assert(d.entities.has('Inner'), 'Object in package exists');
	assert(d.entities.get('Inner').type === EntityType.OBJECT, 'Packaged object type');
	assert(d.packages.length === 1, 'Package exists');
	console.log('  Object in package: OK');
}

{
	// Mixed objects and classes
	const d = parseClassDiagram(`class MyClass {
	+name : String
}
object myObj {
	name = "test"
}
myObj --> MyClass`);
	assert(d.entities.get('MyClass').type === EntityType.CLASS, 'Class type preserved');
	assert(d.entities.get('myObj').type === EntityType.OBJECT, 'Object type preserved');
	assert(d.links.length === 1, 'Link between object and class');
	console.log('  Mixed objects and classes: OK');
}

// ── Map Parser Tests ────────────────────────────────────────────────────

section('Map Parser');

{
	// Basic map with key-value entries
	const d = parseClassDiagram(`map "Config" as config {
	host => localhost
	port => 8080
}`);
	assert(d.entities.has('config'), 'Map parsed');
	assert(d.entities.get('config').type === EntityType.MAP, 'Type is MAP');
	assert(d.entities.get('config').mapEntries.length === 2, 'Two map entries');
	assert(d.entities.get('config').mapEntries[0].key === 'host', 'Map key');
	assert(d.entities.get('config').mapEntries[0].value === 'localhost', 'Map value');
	console.log('  Basic map: OK');
}

{
	// Map without alias
	const d = parseClassDiagram(`map Ports {
	http => 80
	https => 443
}`);
	assert(d.entities.has('Ports'), 'Map without alias parsed');
	assert(d.entities.get('Ports').type === EntityType.MAP, 'Map type');
	assert(d.entities.get('Ports').mapEntries.length === 2, 'Two entries');
	console.log('  Map without alias: OK');
}

{
	// Map with linked entry
	const d = parseClassDiagram(`object User {
	name = "Alice"
}
map "Details" as details {
	user *--> User
	role => admin
}`);
	const map = d.entities.get('details');
	assert(map !== undefined, 'Map exists');
	assert(map.mapEntries.length === 2, 'Two map entries');
	assert(map.mapEntries[0].key === 'user', 'Linked entry key');
	assert(map.mapEntries[0].linkedTarget === 'User', 'Linked target');
	assert(map.mapEntries[0].value === null, 'Linked entry has no value');
	assert(map.mapEntries[1].key === 'role', 'Normal entry key');
	assert(map.mapEntries[1].value === 'admin', 'Normal entry value');
	assert(d.links.length >= 1, 'Link created from map entry');
	console.log('  Map with linked entry: OK');
}

{
	// Map with long arrow linked entry
	const d = parseClassDiagram(`object Target
map myMap {
	key *---> Target
}`);
	const map = d.entities.get('myMap');
	assert(map.mapEntries[0].linkedTarget === 'Target', 'Long arrow linked target');
	console.log('  Map with long arrow: OK');
}

{
	// Links between maps
	const d = parseClassDiagram(`map A {
	x => 1
}
map B {
	y => 2
}
A --> B`);
	assert(d.links.length === 1, 'Link between maps');
	console.log('  Links between maps: OK');
}

{
	// Map with empty value
	const d = parseClassDiagram(`map EmptyVal {
	key =>
}`);
	assert(d.entities.get('EmptyVal').mapEntries[0].value === '', 'Empty value parsed');
	console.log('  Map with empty value: OK');
}

// ── JSON Parser Tests ───────────────────────────────────────────────────

section('JSON Parser');

{
	// Basic JSON object
	const d = parseClassDiagram(`json "Profile" as profile {
	"name": "Alice",
	"age": 30
}`);
	assert(d.entities.has('profile'), 'JSON entity parsed');
	assert(d.entities.get('profile').type === EntityType.JSON, 'Type is JSON');
	const node = d.entities.get('profile').jsonNode;
	assert(node !== null, 'JSON node exists');
	assert(node.type === JsonNodeType.OBJECT, 'JSON node is object');
	assert(node.entries.length === 2, 'Two JSON entries');
	assert(node.entries[0].key === 'name', 'JSON key');
	assert(node.entries[0].value.value === 'Alice', 'JSON value');
	assert(node.entries[1].value.value === '30', 'JSON number');
	console.log('  Basic JSON object: OK');
}

{
	// Nested JSON object
	const d = parseClassDiagram(`json nested {
	"server": {
		"host": "localhost",
		"port": 8080
	}
}`);
	const node = d.entities.get('nested').jsonNode;
	assert(node.entries[0].key === 'server', 'Nested key');
	assert(node.entries[0].value.type === JsonNodeType.OBJECT, 'Nested value is object');
	assert(node.entries[0].value.entries.length === 2, 'Nested entries');
	console.log('  Nested JSON object: OK');
}

{
	// JSON with array
	const d = parseClassDiagram(`json withArray {
	"tags": ["admin", "user"],
	"active": true
}`);
	const node = d.entities.get('withArray').jsonNode;
	assert(node.entries[0].key === 'tags', 'Array key');
	assert(node.entries[0].value.type === JsonNodeType.ARRAY, 'Array type');
	assert(node.entries[0].value.items.length === 2, 'Two array items');
	assert(node.entries[0].value.items[0].value === 'admin', 'Array item value');
	assert(node.entries[1].key === 'active', 'Boolean key');
	assert(node.entries[1].value.value === 'true', 'Boolean value');
	console.log('  JSON with array: OK');
}

{
	// JSON null value
	const d = parseClassDiagram(`json nullTest {
	"value": null
}`);
	const node = d.entities.get('nullTest').jsonNode;
	assert(node.entries[0].value.value === 'null', 'Null value parsed');
	console.log('  JSON null value: OK');
}

{
	// JSON without alias
	const d = parseClassDiagram(`json SimpleJson {
	"key": "val"
}`);
	assert(d.entities.has('SimpleJson'), 'JSON without alias');
	assert(d.entities.get('SimpleJson').type === EntityType.JSON, 'JSON type');
	console.log('  JSON without alias: OK');
}

{
	// Links between JSON entities
	const d = parseClassDiagram(`json A {
	"x": 1
}
json B {
	"y": 2
}
A --> B`);
	assert(d.links.length === 1, 'Link between JSON entities');
	console.log('  Links between JSON entities: OK');
}

// ── Object/Map/JSON Emitter Tests ───────────────────────────────────────

section('Object Emitter');

{
	// Object emits swimlane with underline
	const d = parseClassDiagram(`object Foo {
	name = "Alice"
}`);
	const cells = emitClassDiagram(d, 'parent-1');
	const xml = cells.join('\n');
	assert(xml.includes('swimlane'), 'Object uses swimlane');
	assert(xml.includes('fontStyle=4'), 'Object header is underlined');
	console.log('  Object swimlane with underline: OK');
}

{
	// Map emits swimlane with entries
	const d = parseClassDiagram(`map Config {
	host => localhost
	port => 8080
}`);
	const cells = emitClassDiagram(d, 'parent-1');
	const xml = cells.join('\n');
	assert(xml.includes('swimlane'), 'Map uses swimlane');
	assert(xml.includes('host'), 'Map contains key');
	assert(xml.includes('localhost'), 'Map contains value');
	console.log('  Map emission: OK');
}

{
	// JSON emits swimlane with flattened rows
	const d = parseClassDiagram(`json Data {
	"name": "Alice",
	"age": 30
}`);
	const cells = emitClassDiagram(d, 'parent-1');
	const xml = cells.join('\n');
	assert(xml.includes('swimlane'), 'JSON uses swimlane');
	assert(xml.includes('name'), 'JSON contains key');
	assert(xml.includes('Alice'), 'JSON contains value');
	console.log('  JSON emission: OK');
}

// ── Object/Map/JSON Pipeline Tests ──────────────────────────────────────

section('Object Pipeline');

{
	// Object diagram converts successfully
	const result = convert(`@startuml
object alice {
	name = "Alice"
	age = 30
}
object bob {
	name = "Bob"
}
alice --> bob : knows
@enduml`);
	assert(result.diagramType === 'class', 'Object diagram detected as class type');
	assert(result.xml.includes('alice'), 'Output contains alice');
	assert(result.xml.includes('bob'), 'Output contains bob');
	console.log('  Object pipeline: OK');
}

{
	// Map diagram converts successfully
	const result = convert(`@startuml
map Config {
	host => localhost
}
map Ports {
	http => 80
}
Config --> Ports
@enduml`);
	assert(result.diagramType === 'class', 'Map diagram detected as class type');
	assert(result.xml.includes('Config'), 'Output contains Config');
	console.log('  Map pipeline: OK');
}

{
	// Object type detection
	const type = detectDiagramType(`object alice {
	name = "Alice"
}
object bob {
	name = "Bob"
}
alice --> bob : knows`);
	assert(type === 'class', 'Object diagram detected as class type');
	console.log('  Object type detection: OK');
}

{
	// Existing types still work after adding object/map/json
	const seqType = detectDiagramType('Alice -> Bob : hello');
	assert(seqType === 'sequence', 'Sequence still detected');
	const classType = detectDiagramType(`class Foo
class Bar
Foo <|-- Bar`);
	assert(classType === 'class', 'Class still detected');
	const ucType = detectDiagramType(`@startusecase
actor User
usecase (Login)
User --> (Login)`);
	assert(ucType === 'usecase', 'Usecase still detected');
	console.log('  Existing types unaffected: OK');
}

// ── Activity Parser Tests ────────────────────────────────────────────────

section('Activity Parser');

{
	// Simple action
	const d = parseActivityDiagram(':Hello World;');
	assert(d.instructions.length === 1, 'Simple action: 1 instruction');
	assert(d.instructions[0].type === InstructionType.ACTION, 'Simple action: type is ACTION');
	assert(d.instructions[0].label === 'Hello World', 'Simple action: label is "Hello World"');
	console.log('  Simple action: OK');
}

{
	// Multiline action
	const d = parseActivityDiagram(':line one\nline two;');
	assert(d.instructions.length === 1, 'Multiline action: 1 instruction');
	assert(d.instructions[0].type === InstructionType.ACTION, 'Multiline action: type is ACTION');
	assert(d.instructions[0].label === 'line one\nline two', 'Multiline action: label has both lines');
	console.log('  Multiline action: OK');
}

{
	// Colored action
	const d = parseActivityDiagram('#LightBlue:Colored action;');
	assert(d.instructions.length === 1, 'Colored action: 1 instruction');
	assert(d.instructions[0].color === '#LightBlue', 'Colored action: color is #LightBlue');
	assert(d.instructions[0].label === 'Colored action', 'Colored action: label correct');
	console.log('  Colored action: OK');
}

{
	// Start and stop
	const d = parseActivityDiagram('start\n:Do something;\nstop');
	assert(d.instructions.length === 3, 'Start/stop: 3 instructions');
	assert(d.instructions[0].type === InstructionType.START, 'Start/stop: first is START');
	assert(d.instructions[1].type === InstructionType.ACTION, 'Start/stop: second is ACTION');
	assert(d.instructions[2].type === InstructionType.STOP, 'Start/stop: third is STOP');
	console.log('  Start and stop: OK');
}

{
	// End
	const d = parseActivityDiagram('start\n:Action;\nend');
	assert(d.instructions[2].type === InstructionType.END, 'End: type is END');
	console.log('  End: OK');
}

{
	// Kill
	const d = parseActivityDiagram('start\n:Action;\nkill');
	assert(d.instructions[2].type === InstructionType.KILL, 'Kill: type is KILL');
	console.log('  Kill: OK');
}

{
	// Detach (synonym for kill)
	const d = parseActivityDiagram('start\n:Action;\ndetach');
	assert(d.instructions[2].type === InstructionType.KILL, 'Detach: type is KILL');
	console.log('  Detach: OK');
}

{
	// Arrow with label
	const d = parseActivityDiagram('start\n-> Custom label;\n:Action;');
	assert(d.instructions.length === 3, 'Arrow: 3 instructions (start, arrow, action)');
	assert(d.instructions[1].type === InstructionType.ARROW, 'Arrow: type is ARROW');
	assert(d.instructions[1].arrowLabel === 'Custom label', 'Arrow: label correct');
	console.log('  Arrow with label: OK');
}

{
	// Arrow with color
	const d = parseActivityDiagram('-[#red]-> Styled;\n:Action;');
	assert(d.instructions[0].type === InstructionType.ARROW, 'Colored arrow: type is ARROW');
	assert(d.instructions[0].arrowColor === '#red', 'Colored arrow: color is #red');
	assert(d.instructions[0].arrowLabel === 'Styled', 'Colored arrow: label correct');
	console.log('  Arrow with color: OK');
}

{
	// Title
	const d = parseActivityDiagram('title My Activity\nstart\nstop');
	assert(d.title === 'My Activity', 'Title: parsed correctly');
	console.log('  Title: OK');
}

{
	// If/then/else
	const d = parseActivityDiagram(`if (test?) then (yes)
  :Then action;
else (no)
  :Else action;
endif`);
	assert(d.instructions.length === 1, 'If: 1 top-level instruction');
	const ifInstr = d.instructions[0];
	assert(ifInstr.type === InstructionType.IF, 'If: type is IF');
	assert(ifInstr.condition === 'test?', 'If: condition correct');
	assert(ifInstr.thenLabel === 'yes', 'If: then label correct');
	assert(ifInstr.elseLabel === 'no', 'If: else label correct');
	assert(ifInstr.thenBranch.length === 1, 'If: then branch has 1 instruction');
	assert(ifInstr.elseBranch.length === 1, 'If: else branch has 1 instruction');
	assert(ifInstr.thenBranch[0].label === 'Then action', 'If: then action correct');
	assert(ifInstr.elseBranch[0].label === 'Else action', 'If: else action correct');
	console.log('  If/then/else: OK');
}

{
	// ElseIf
	const d = parseActivityDiagram(`if (A?) then (yes)
  :Branch A;
elseif (B?) then (yes)
  :Branch B;
else (no)
  :Branch C;
endif`);
	const ifInstr = d.instructions[0];
	assert(ifInstr.type === InstructionType.IF, 'ElseIf: type is IF');
	assert(ifInstr.thenBranch.length === 1, 'ElseIf: then branch has 1');
	assert(ifInstr.elseIfBranches.length === 1, 'ElseIf: 1 elseif branch');
	assert(ifInstr.elseIfBranches[0].condition === 'B?', 'ElseIf: condition correct');
	assert(ifInstr.elseBranch.length === 1, 'ElseIf: else branch has 1');
	console.log('  ElseIf: OK');
}

{
	// Nested if
	const d = parseActivityDiagram(`if (outer?) then (yes)
  if (inner?) then (yes)
    :Inner action;
  endif
endif`);
	const outer = d.instructions[0];
	assert(outer.type === InstructionType.IF, 'Nested if: outer is IF');
	assert(outer.thenBranch.length === 1, 'Nested if: then has 1');
	const inner = outer.thenBranch[0];
	assert(inner.type === InstructionType.IF, 'Nested if: inner is IF');
	assert(inner.thenBranch.length === 1, 'Nested if: inner then has 1');
	console.log('  Nested if: OK');
}

// ── Activity Parser — Tier 2 ───────────────────────────────────────────

section('Activity Parser — Tier 2');

{
	// While loop
	const d = parseActivityDiagram(`while (more data?) is (yes)
  :Process data;
endwhile (no)`);
	assert(d.instructions.length === 1, 'While: 1 instruction');
	const w = d.instructions[0];
	assert(w.type === InstructionType.WHILE, 'While: type is WHILE');
	assert(w.whileCondition === 'more data?', 'While: condition correct');
	assert(w.whileYesLabel === 'yes', 'While: yes label correct');
	assert(w.whileNoLabel === 'no', 'While: no label correct');
	assert(w.whileBody.length === 1, 'While: body has 1 instruction');
	console.log('  While loop: OK');
}

{
	// Repeat loop
	const d = parseActivityDiagram(`repeat
  :Process;
repeat while (again?) is (yes) not (done)`);
	assert(d.instructions.length === 1, 'Repeat: 1 instruction');
	const r = d.instructions[0];
	assert(r.type === InstructionType.REPEAT, 'Repeat: type is REPEAT');
	assert(r.repeatBody.length === 1, 'Repeat: body has 1 instruction');
	assert(r.repeatCondition === 'again?', 'Repeat: condition correct');
	assert(r.repeatYesLabel === 'yes', 'Repeat: yes label correct');
	assert(r.repeatNoLabel === 'done', 'Repeat: no label correct');
	console.log('  Repeat loop: OK');
}

{
	// Repeat with start label
	const d = parseActivityDiagram(`repeat :Initialize;
  :Process;
repeat while (again?)`);
	const r = d.instructions[0];
	assert(r.repeatStartLabel === 'Initialize', 'Repeat start label: correct');
	console.log('  Repeat with start label: OK');
}

{
	// Switch/case
	const d = parseActivityDiagram(`switch (status?)
case (Active)
  :Handle active;
case (Pending)
  :Handle pending;
case (Closed)
  :Handle closed;
endswitch`);
	assert(d.instructions.length === 1, 'Switch: 1 instruction');
	const s = d.instructions[0];
	assert(s.type === InstructionType.SWITCH, 'Switch: type is SWITCH');
	assert(s.switchCondition === 'status?', 'Switch: condition correct');
	assert(s.switchCases.length === 3, 'Switch: 3 cases');
	assert(s.switchCases[0].label === 'Active', 'Switch: case 1 label correct');
	assert(s.switchCases[1].label === 'Pending', 'Switch: case 2 label correct');
	assert(s.switchCases[2].label === 'Closed', 'Switch: case 3 label correct');
	assert(s.switchCases[0].instructions.length === 1, 'Switch: case 1 has 1 instruction');
	console.log('  Switch/case: OK');
}

{
	// Break
	const d = parseActivityDiagram(`while (test?)
  :Action;
  break
endwhile`);
	const w = d.instructions[0];
	assert(w.whileBody.length === 2, 'Break: body has 2 instructions');
	assert(w.whileBody[1].type === InstructionType.BREAK, 'Break: type is BREAK');
	console.log('  Break: OK');
}

// ── Activity Parser — Tier 3 ───────────────────────────────────────────

section('Activity Parser — Tier 3');

{
	// Fork/join
	const d = parseActivityDiagram(`fork
  :Branch A;
fork again
  :Branch B;
fork again
  :Branch C;
end fork`);
	assert(d.instructions.length === 1, 'Fork: 1 instruction');
	const f = d.instructions[0];
	assert(f.type === InstructionType.FORK, 'Fork: type is FORK');
	assert(f.branches.length === 3, 'Fork: 3 branches');
	assert(f.branches[0].length === 1, 'Fork: branch 1 has 1 instruction');
	assert(f.branches[1].length === 1, 'Fork: branch 2 has 1 instruction');
	assert(f.branches[2].length === 1, 'Fork: branch 3 has 1 instruction');
	console.log('  Fork/join: OK');
}

{
	// Split
	const d = parseActivityDiagram(`split
  :Path A;
split again
  :Path B;
end split`);
	assert(d.instructions.length === 1, 'Split: 1 instruction');
	const s = d.instructions[0];
	assert(s.type === InstructionType.SPLIT, 'Split: type is SPLIT');
	assert(s.branches.length === 2, 'Split: 2 branches');
	console.log('  Split: OK');
}

{
	// Partition
	const d = parseActivityDiagram(`partition "Business Logic" {
  :Inside partition;
  :More logic;
}`);
	assert(d.instructions.length === 1, 'Partition: 1 instruction');
	const p = d.instructions[0];
	assert(p.type === InstructionType.PARTITION, 'Partition: type is PARTITION');
	assert(p.partitionName === 'Business Logic', 'Partition: name correct');
	assert(p.partitionBody.length === 2, 'Partition: body has 2 instructions');
	console.log('  Partition: OK');
}

{
	// Partition with color
	const d = parseActivityDiagram(`partition #LightGreen "Colored" {
  :Action;
}`);
	const p = d.instructions[0];
	assert(p.partitionColor === '#LightGreen', 'Partition color: correct');
	console.log('  Partition with color: OK');
}

{
	// Swimlane
	const d = parseActivityDiagram(`|Swimlane A|
:Action in A;
|Swimlane B|
:Action in B;`);
	assert(d.swimlanes.size === 2, 'Swimlane: 2 lanes');
	assert(d.swimlanes.has('Swimlane A'), 'Swimlane: has "Swimlane A"');
	assert(d.swimlanes.has('Swimlane B'), 'Swimlane: has "Swimlane B"');
	assert(d.instructions[0].swimlane === 'Swimlane A', 'Swimlane: first action in lane A');
	assert(d.instructions[1].swimlane === 'Swimlane B', 'Swimlane: second action in lane B');
	console.log('  Swimlanes: OK');
}

{
	// Note single-line
	const d = parseActivityDiagram('note right: This is a note');
	assert(d.instructions.length === 1, 'Note: 1 instruction');
	const n = d.instructions[0];
	assert(n.type === InstructionType.NOTE, 'Note: type is NOTE');
	assert(n.notePosition === ActNotePosition.RIGHT, 'Note: position is RIGHT');
	assert(n.noteText === 'This is a note', 'Note: text correct');
	assert(n.noteFloating === false, 'Note: not floating');
	console.log('  Note single-line: OK');
}

{
	// Note multiline
	const d = parseActivityDiagram(`note left
  Line 1
  Line 2
end note`);
	assert(d.instructions.length === 1, 'Multiline note: 1 instruction');
	const n = d.instructions[0];
	assert(n.type === InstructionType.NOTE, 'Multiline note: type is NOTE');
	assert(n.notePosition === ActNotePosition.LEFT, 'Multiline note: position is LEFT');
	assert(n.noteText.includes('Line 1'), 'Multiline note: contains Line 1');
	assert(n.noteText.includes('Line 2'), 'Multiline note: contains Line 2');
	console.log('  Note multiline: OK');
}

{
	// Floating note
	const d = parseActivityDiagram('floating note right: Floating');
	const n = d.instructions[0];
	assert(n.noteFloating === true, 'Floating note: is floating');
	console.log('  Floating note: OK');
}

// ── Activity Emitter Tests ──────────────────────────────────────────────

section('Activity Emitter');

{
	// Basic action emission
	const d = parseActivityDiagram(':Hello;');
	const cells = emitActivityDiagram(d, 'test-parent');
	const cellStr = cells.join('\n');
	assert(cellStr.includes('vertex="1"'), 'Action emit: has vertex');
	assert(cellStr.includes('rounded=1'), 'Action emit: has rounded style');
	assert(cellStr.includes('Hello'), 'Action emit: has label');
	console.log('  Action emission: OK');
}

{
	// Start circle emission
	const d = parseActivityDiagram('start');
	const cells = emitActivityDiagram(d, 'test-parent');
	const cellStr = cells.join('\n');
	assert(cellStr.includes('ellipse'), 'Start emit: has ellipse style');
	assert(cellStr.includes('fillColor=#000000'), 'Start emit: black fill');
	console.log('  Start circle emission: OK');
}

{
	// Diamond for if
	const d = parseActivityDiagram('if (test?) then (yes)\n  :Action;\nendif');
	const cells = emitActivityDiagram(d, 'test-parent');
	const cellStr = cells.join('\n');
	assert(cellStr.includes('rhombus'), 'If emit: has diamond (rhombus)');
	assert(cellStr.includes('edge="1"'), 'If emit: has edges');
	console.log('  Diamond for if: OK');
}

{
	// Edge between sequential actions
	const d = parseActivityDiagram('start\n:Action;\nstop');
	const cells = emitActivityDiagram(d, 'test-parent');
	const cellStr = cells.join('\n');
	const edgeCount = (cellStr.match(/edge="1"/g) || []).length;
	assert(edgeCount >= 2, 'Sequential edges: at least 2 edges (start->action, action->stop)');
	console.log('  Edges between sequential actions: OK');
}

{
	// Fork bars
	const d = parseActivityDiagram('fork\n  :A;\nfork again\n  :B;\nend fork');
	const cells = emitActivityDiagram(d, 'test-parent');
	const cellStr = cells.join('\n');
	assert(cellStr.includes('fillColor=#000000'), 'Fork emit: has black bars');
	const vertexCount = (cellStr.match(/vertex="1"/g) || []).length;
	assert(vertexCount >= 4, 'Fork emit: at least 4 vertices (2 bars + 2 actions)');
	console.log('  Fork bars emission: OK');
}

// ── Activity Pipeline Tests ─────────────────────────────────────────────

section('Activity Pipeline');

{
	// Full conversion
	const result = convert('start\n:Hello World;\nstop');
	assert(result.diagramType === 'activity', 'Pipeline: detected as activity');
	assert(result.xml.includes('<mxfile>'), 'Pipeline: has mxfile wrapper');
	assert(result.xml.includes('Hello World'), 'Pipeline: contains label');
	console.log('  Basic conversion: OK');
}

{
	// Type detection
	const type = detectDiagramType('start\n:Action;\nstop');
	assert(type === 'activity', 'Detection: simple activity detected');
	console.log('  Type detection: OK');
}

{
	// Explicit @startactivity
	const type = detectDiagramType('@startactivity\n:Action;\nstop');
	assert(type === 'activity', 'Detection: @startactivity detected');
	console.log('  @startactivity detection: OK');
}

{
	// No collision with existing types
	const seqType = detectDiagramType('Alice -> Bob : hello');
	assert(seqType === 'sequence', 'No collision: sequence still detected');
	const classType = detectDiagramType('class Foo\nclass Bar\nFoo <|-- Bar');
	assert(classType === 'class', 'No collision: class still detected');
	const ucType = detectDiagramType('@startusecase\nactor User\nusecase (Login)\nUser --> (Login)');
	assert(ucType === 'usecase', 'No collision: usecase still detected');
	console.log('  No collision with existing types: OK');
}

{
	// Activity with if/else converted
	const result = convert(`start
if (condition?) then (yes)
  :True path;
else (no)
  :False path;
endif
stop`);
	assert(result.diagramType === 'activity', 'If pipeline: detected as activity');
	assert(result.xml.includes('rhombus'), 'If pipeline: has diamond');
	assert(result.xml.includes('True path'), 'If pipeline: has then label');
	assert(result.xml.includes('False path'), 'If pipeline: has else label');
	console.log('  If/else conversion: OK');
}

// ── Summary ──────────────────────────────────────────────────────────────

section('Results');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
	process.exit(1);
}
