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
import { parseComponentDiagram } from './diagrams/component/ComponentParser.js';
import { emitComponentDiagram } from './diagrams/component/ComponentEmitter.js';
import {
	ElementType as CompElementType,
	RelationDecor as CompRelationDecor,
	LineStyle as CompLineStyle,
	Direction as CompDirection,
	NotePosition as CompNotePosition,
	ComponentElement, ComponentRelationship, ComponentContainer, ComponentNote, ComponentDiagram
} from './diagrams/component/ComponentModel.js';
import { parseStateDiagram } from './diagrams/state/StateParser.js';
import { emitStateDiagram } from './diagrams/state/StateEmitter.js';
import {
	StateType, TransitionStyle, TransitionDirection,
	NotePosition as StateNotePosition, DiagramDirection as StateDiagramDirection,
	StateElement, StateTransition, StateNote, StateDiagram
} from './diagrams/state/StateModel.js';
import { parseTimingDiagram } from './diagrams/timing/TimingParser.js';
import { emitTimingDiagram } from './diagrams/timing/TimingEmitter.js';
import {
	PlayerType, NotePosition as TimingNotePosition,
	TimingPlayer, StateChange, TimeConstraint, TimeMessage,
	TimingHighlight, TimingNote, TimingDiagram as TimingDiagramModel
} from './diagrams/timing/TimingModel.js';

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
	assert(cellStr.includes('fillColor=#444444'), 'Fork emit: has dark gray bars');
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

// ══════════════════════════════════════════════════════════════════════════
// COMPONENT / DEPLOYMENT DIAGRAM TESTS
// ══════════════════════════════════════════════════════════════════════════

section('Component Parser');

{
	// Bracket shorthand
	const d = parseComponentDiagram('[Component A]\n[Component B] as B');
	assert(d.elements.size === 2, 'Bracket shorthand: 2 elements');
	assert(d.elements.has('ComponentA'), 'Bracket shorthand: ComponentA exists');
	assert(d.elements.has('B'), 'Bracket shorthand: B alias exists');
	const compA = d.elements.get('ComponentA');
	assert(compA.type === CompElementType.COMPONENT, 'Bracket shorthand: type is COMPONENT');
	assert(compA.displayName === 'Component A', 'Bracket shorthand: display name preserved');
	console.log('  Bracket shorthand: OK');
}

{
	// Quoted bracket shorthand
	const d = parseComponentDiagram('["Display Name"] as DN');
	assert(d.elements.size === 1, 'Quoted bracket: 1 element');
	assert(d.elements.has('DN'), 'Quoted bracket: alias DN');
	assert(d.elements.get('DN').displayName === 'Display Name', 'Quoted bracket: display name');
	console.log('  Quoted bracket shorthand: OK');
}

{
	// Interface shorthand
	const d = parseComponentDiagram('() "HTTP API" as http\n() REST');
	assert(d.elements.size === 2, 'Interface shorthand: 2 elements');
	assert(d.elements.has('http'), 'Interface shorthand: http alias');
	assert(d.elements.get('http').type === CompElementType.INTERFACE, 'Interface shorthand: type INTERFACE');
	assert(d.elements.has('REST'), 'Interface shorthand: REST');
	assert(d.elements.get('REST').type === CompElementType.INTERFACE, 'Interface shorthand: REST type');
	console.log('  Interface shorthand: OK');
}

{
	// Keyword declarations
	const d = parseComponentDiagram(
		'component "Web Server" as WS\n' +
		'node "App Server" as AS\n' +
		'cloud "AWS" as aws\n' +
		'database "DB" as db\n' +
		'storage "S3" as s3\n' +
		'artifact "app.war" as war\n' +
		'folder "Logs" as logs\n' +
		'file "config.yml" as cfg\n' +
		'agent "Monitor" as mon\n' +
		'person "Admin" as adm'
	);
	assert(d.elements.size === 10, 'Keyword declarations: 10 elements');
	assert(d.elements.get('WS').type === CompElementType.COMPONENT, 'Keyword: WS is COMPONENT');
	assert(d.elements.get('AS').type === CompElementType.NODE, 'Keyword: AS is NODE');
	assert(d.elements.get('aws').type === CompElementType.CLOUD, 'Keyword: aws is CLOUD');
	assert(d.elements.get('db').type === CompElementType.DATABASE, 'Keyword: db is DATABASE');
	assert(d.elements.get('s3').type === CompElementType.STORAGE, 'Keyword: s3 is STORAGE');
	assert(d.elements.get('war').type === CompElementType.ARTIFACT, 'Keyword: war is ARTIFACT');
	assert(d.elements.get('logs').type === CompElementType.FOLDER, 'Keyword: logs is FOLDER');
	assert(d.elements.get('cfg').type === CompElementType.FILE, 'Keyword: cfg is FILE');
	assert(d.elements.get('mon').type === CompElementType.AGENT, 'Keyword: mon is AGENT');
	assert(d.elements.get('adm').type === CompElementType.PERSON, 'Keyword: adm is PERSON');
	console.log('  Keyword declarations: OK');
}

{
	// More keyword types
	const d = parseComponentDiagram(
		'hexagon "Router" as rtr\n' +
		'card "License" as lic\n' +
		'queue "MQ" as mq\n' +
		'stack "Stack" as stk\n' +
		'boundary "Gateway" as gw\n' +
		'control "LB" as lb\n' +
		'entity "Cache" as cache\n' +
		'label "v1.0" as ver\n' +
		'collections "Services" as svcs'
	);
	assert(d.elements.get('rtr').type === CompElementType.HEXAGON, 'Keyword: rtr is HEXAGON');
	assert(d.elements.get('lic').type === CompElementType.CARD, 'Keyword: lic is CARD');
	assert(d.elements.get('mq').type === CompElementType.QUEUE, 'Keyword: mq is QUEUE');
	assert(d.elements.get('stk').type === CompElementType.STACK, 'Keyword: stk is STACK');
	assert(d.elements.get('gw').type === CompElementType.BOUNDARY, 'Keyword: gw is BOUNDARY');
	assert(d.elements.get('lb').type === CompElementType.CONTROL, 'Keyword: lb is CONTROL');
	assert(d.elements.get('cache').type === CompElementType.ENTITY_DESC, 'Keyword: cache is ENTITY_DESC');
	assert(d.elements.get('ver').type === CompElementType.LABEL, 'Keyword: ver is LABEL');
	assert(d.elements.get('svcs').type === CompElementType.COLLECTIONS, 'Keyword: svcs is COLLECTIONS');
	console.log('  Extended keyword types: OK');
}

{
	// Stereotypes and colors
	const d = parseComponentDiagram('component "Auth" as auth <<Service>> #LightBlue');
	const auth = d.elements.get('auth');
	assert(auth.stereotypes.length === 1, 'Stereotype: has 1');
	assert(auth.stereotypes[0] === 'Service', 'Stereotype: value is Service');
	assert(auth.color === '#LightBlue', 'Color: #LightBlue');
	console.log('  Stereotypes and colors: OK');
}

{
	// Container nesting
	const d = parseComponentDiagram(
		'node "Server" {\n' +
		'  component "App" as app\n' +
		'  database "DB" as db\n' +
		'}'
	);
	assert(d.containers.length === 1, 'Container: 1 top-level');
	assert(d.containers[0].type === CompElementType.NODE, 'Container: type is NODE');
	assert(d.containers[0].elements.length === 2, 'Container: 2 elements');
	assert(d.containers[0].elements.includes('app'), 'Container: has app');
	assert(d.containers[0].elements.includes('db'), 'Container: has db');
	assert(d.elements.get('app').containerPath === 'Server', 'Container: app containerPath');
	console.log('  Container nesting: OK');
}

{
	// Nested containers
	const d = parseComponentDiagram(
		'cloud "AWS" {\n' +
		'  node "Cluster" {\n' +
		'    [Worker]\n' +
		'  }\n' +
		'  database "RDS" as rds\n' +
		'}'
	);
	assert(d.containers.length === 1, 'Nested containers: 1 top-level');
	assert(d.containers[0].subContainers.length === 1, 'Nested containers: 1 sub');
	assert(d.containers[0].subContainers[0].type === CompElementType.NODE, 'Nested containers: sub is NODE');
	assert(d.containers[0].subContainers[0].elements.includes('Worker'), 'Nested containers: Worker in sub');
	assert(d.containers[0].elements.includes('rds'), 'Nested containers: rds in cloud');
	console.log('  Nested containers: OK');
}

{
	// Link parsing
	const d = parseComponentDiagram('[A] --> [B] : uses\n[A] ..> [C]\n[A] ==> [D]');
	assert(d.links.length === 3, 'Links: 3 links');
	assert(d.links[0].rightDecor === CompRelationDecor.ARROW, 'Link 0: right arrow');
	assert(d.links[0].lineStyle === CompLineStyle.SOLID, 'Link 0: solid');
	assert(d.links[0].label === 'uses', 'Link 0: label');
	assert(d.links[1].lineStyle === CompLineStyle.DASHED, 'Link 1: dashed');
	assert(d.links[2].lineStyle === CompLineStyle.BOLD, 'Link 2: bold');
	console.log('  Link parsing: OK');
}

{
	// Link decorators
	const d = parseComponentDiagram('[A] --|> [B]\n[A] *-- [C]\n[A] o-- [D]\n[A] <|.. [E]');
	assert(d.links[0].rightDecor === CompRelationDecor.EXTENDS, 'Decor: --|> extends');
	assert(d.links[1].leftDecor === CompRelationDecor.COMPOSITION, 'Decor: *-- composition');
	assert(d.links[2].leftDecor === CompRelationDecor.AGGREGATION, 'Decor: o-- aggregation');
	assert(d.links[3].leftDecor === CompRelationDecor.EXTENDS, 'Decor: <|.. extends');
	assert(d.links[3].lineStyle === CompLineStyle.DASHED, 'Decor: <|.. dashed');
	console.log('  Link decorators: OK');
}

{
	// Direction hints
	const d = parseComponentDiagram('[A] -right-> [B]\n[A] -down-> [C]\n[A] -up-> [D]');
	assert(d.links[0].direction === CompDirection.RIGHT, 'Direction: right');
	assert(d.links[1].direction === CompDirection.DOWN, 'Direction: down');
	assert(d.links[2].direction === CompDirection.UP, 'Direction: up');
	console.log('  Direction hints: OK');
}

{
	// Auto-creation from links
	const d = parseComponentDiagram('[A] --> [B]');
	assert(d.elements.size === 2, 'Auto-create: 2 elements');
	assert(d.elements.get('A').type === CompElementType.COMPONENT, 'Auto-create: A is COMPONENT');
	assert(d.elements.get('B').type === CompElementType.COMPONENT, 'Auto-create: B is COMPONENT');
	console.log('  Auto-creation from links: OK');
}

{
	// Notes
	const d = parseComponentDiagram('[A] as A\nnote left of A : This is A');
	assert(d.notes.length === 1, 'Notes: 1 note');
	assert(d.notes[0].entityCode === 'A', 'Notes: attached to A');
	assert(d.notes[0].text === 'This is A', 'Notes: text');
	assert(d.notes[0].position === CompNotePosition.LEFT, 'Notes: position left');
	console.log('  Notes: OK');
}

{
	// Floating notes
	const d = parseComponentDiagram('note "Floating note" as N1');
	assert(d.notes.length === 1, 'Floating note: 1 note');
	assert(d.notes[0].alias === 'N1', 'Floating note: alias N1');
	assert(d.notes[0].text === 'Floating note', 'Floating note: text');
	console.log('  Floating note: OK');
}

{
	// Note on link
	const d = parseComponentDiagram('[A] --> [B]\nnote on link : Critical');
	assert(d.notes.length === 1, 'Note on link: 1 note');
	assert(d.notes[0].isOnLink === true, 'Note on link: isOnLink');
	assert(d.notes[0].linkIndex === 0, 'Note on link: linkIndex 0');
	console.log('  Note on link: OK');
}

{
	// Multi-line note
	const d = parseComponentDiagram('[A] as A\nnote right of A\n  Line 1\n  Line 2\nend note');
	assert(d.notes.length === 1, 'Multiline note: 1 note');
	assert(d.notes[0].text.includes('Line 1'), 'Multiline note: has Line 1');
	assert(d.notes[0].text.includes('Line 2'), 'Multiline note: has Line 2');
	console.log('  Multi-line note: OK');
}

{
	// Together groups
	const d = parseComponentDiagram('together {\n  component "A" as A\n  component "B" as B\n}');
	assert(d.togetherGroups.length === 1, 'Together: 1 group');
	assert(d.togetherGroups[0].length === 2, 'Together: 2 elements');
	console.log('  Together groups: OK');
}

{
	// Interface and component in links
	const d = parseComponentDiagram('() "HTTP" as http\n[Server] --> http');
	assert(d.elements.get('http').type === CompElementType.INTERFACE, 'Link resolve: http is INTERFACE');
	assert(d.elements.get('Server').type === CompElementType.COMPONENT, 'Link resolve: Server is COMPONENT');
	console.log('  Interface in links: OK');
}

{
	// Keyword alias forms: Code as "Display"
	const d = parseComponentDiagram('component Foo as "Display Foo"');
	assert(d.elements.has('Foo'), 'Alias form: Foo code');
	assert(d.elements.get('Foo').displayName === 'Display Foo', 'Alias form: Display Foo');
	console.log('  Code as Display alias: OK');
}

{
	// Port declarations inside container
	const d = parseComponentDiagram(
		'component "GW" as gw {\n' +
		'  portin "In" as pin\n' +
		'  portout "Out" as pout\n' +
		'}'
	);
	assert(d.elements.get('pin').type === CompElementType.PORTIN, 'Ports: pin is PORTIN');
	assert(d.elements.get('pout').type === CompElementType.PORTOUT, 'Ports: pout is PORTOUT');
	assert(d.containers[0].elements.includes('pin'), 'Ports: pin in container');
	console.log('  Port declarations: OK');
}

{
	// Colored/styled arrows
	const d = parseComponentDiagram('[A] -[#red]-> [B]\n[A] -[bold]-> [C]');
	assert(d.links[0].color === '#red', 'Styled arrow: color red');
	assert(d.links[1].lineStyle === CompLineStyle.BOLD, 'Styled arrow: bold');
	console.log('  Colored/styled arrows: OK');
}

section('Component Emitter');

{
	// Component shape emission
	const d = new ComponentDiagram();
	d.addElement(new ComponentElement('A', 'Component A', CompElementType.COMPONENT));
	const cells = emitComponentDiagram(d, 'parent-1');
	assert(cells.length >= 1, 'Emit component: at least 1 cell');
	assert(cells[0].includes('shape=component'), 'Emit component: shape=component');
	assert(cells[0].includes('Component A'), 'Emit component: label');
	console.log('  Component emission: OK');
}

{
	// Interface shape emission (small circle)
	const d = new ComponentDiagram();
	d.addElement(new ComponentElement('http', 'HTTP', CompElementType.INTERFACE));
	const cells = emitComponentDiagram(d, 'parent-1');
	assert(cells[0].includes('shape=ellipse'), 'Emit interface: shape=ellipse');
	assert(cells[0].includes('width="30"'), 'Emit interface: width 30');
	console.log('  Interface emission: OK');
}

{
	// Node shape emission
	const d = new ComponentDiagram();
	d.addElement(new ComponentElement('srv', 'Server', CompElementType.NODE));
	const cells = emitComponentDiagram(d, 'parent-1');
	assert(cells[0].includes('box3d'), 'Emit node: shape');
	console.log('  Node emission: OK');
}

{
	// Database shape emission
	const d = new ComponentDiagram();
	d.addElement(new ComponentElement('db', 'Database', CompElementType.DATABASE));
	const cells = emitComponentDiagram(d, 'parent-1');
	assert(cells[0].includes('cylinder3'), 'Emit database: shape');
	console.log('  Database emission: OK');
}

{
	// Cloud shape emission
	const d = new ComponentDiagram();
	d.addElement(new ComponentElement('c', 'Cloud', CompElementType.CLOUD));
	const cells = emitComponentDiagram(d, 'parent-1');
	assert(cells[0].includes('shape=cloud'), 'Emit cloud: shape');
	console.log('  Cloud emission: OK');
}

{
	// Edge emission with decorators
	const d = new ComponentDiagram();
	d.addElement(new ComponentElement('A', 'A', CompElementType.COMPONENT));
	d.addElement(new ComponentElement('B', 'B', CompElementType.COMPONENT));
	const link = new ComponentRelationship('A', 'B');
	link.rightDecor = CompRelationDecor.EXTENDS;
	link.lineStyle = CompLineStyle.DASHED;
	link.label = 'realizes';
	d.addLink(link);
	const cells = emitComponentDiagram(d, 'parent-1');
	const edgeCell = cells.find(c => c.includes('edge="1"'));
	assert(edgeCell !== undefined, 'Emit edge: has edge cell');
	assert(edgeCell.includes('endArrow=block'), 'Emit edge: extends arrow');
	assert(edgeCell.includes('dashed=1'), 'Emit edge: dashed');
	assert(edgeCell.includes('realizes'), 'Emit edge: label');
	console.log('  Edge with decorators: OK');
}

{
	// Container emission
	const d = new ComponentDiagram();
	const container = new ComponentContainer('Server', 'Server', CompElementType.NODE, null);
	d.addElement(new ComponentElement('app', 'App', CompElementType.COMPONENT));
	d.elements.get('app').containerPath = 'Server';
	container.elements.push('app');
	d.containers.push(container);
	const cells = emitComponentDiagram(d, 'parent-1');
	assert(cells.length >= 2, 'Emit container: at least 2 cells');
	// First cell should be the container
	assert(cells[0].includes('container=1'), 'Emit container: has container=1');
	assert(cells[0].includes('Server'), 'Emit container: has Server label');
	console.log('  Container emission: OK');
}

{
	// Stereotype in label
	const d = new ComponentDiagram();
	const el = new ComponentElement('auth', 'Auth', CompElementType.COMPONENT);
	el.stereotypes.push('Service');
	d.addElement(el);
	const cells = emitComponentDiagram(d, 'parent-1');
	assert(cells[0].includes('\u00ABService\u00BB'), 'Stereotype in label: present');
	console.log('  Stereotype in label: OK');
}

section('Component Pipeline');

{
	// Full pipeline test
	const result = convert(
		'@startcomponent\n' +
		'[Web Server] as WS\n' +
		'[Database] as DB\n' +
		'WS --> DB : stores data\n' +
		'@endcomponent'
	);
	assert(result.diagramType === 'component', 'Pipeline: detected as component');
	assert(result.xml.includes('shape=component'), 'Pipeline: has component shape');
	assert(result.xml.includes('stores data'), 'Pipeline: has label');
	assert(result.xml.includes('edge="1"'), 'Pipeline: has edge');
	console.log('  Basic conversion: OK');
}

{
	// Type detection
	assert(detectDiagramType('@startcomponent\n[A]\n@endcomponent') === 'component', '@startcomponent detected');
	assert(detectDiagramType('@startdeployment\nnode "S"\n@enddeployment') === 'component', '@startdeployment detected');
	console.log('  Type detection: OK');
}

{
	// Heuristic detection
	assert(detectDiagramType('[A]\n[B]\n[A] --> [B]') === 'component', 'Heuristic: brackets');
	assert(detectDiagramType('component "A" as A\ncomponent "B" as B\nA --> B') === 'component', 'Heuristic: keywords');
	assert(detectDiagramType('node "S" {\n  [App]\n}') === 'component', 'Heuristic: node container + bracket');
	console.log('  Heuristic detection: OK');
}

{
	// No collision with existing types
	const seqType = detectDiagramType('Alice -> Bob : hello');
	assert(seqType === 'sequence', 'No collision: sequence still detected');
	const classType = detectDiagramType('class Foo\nclass Bar\nFoo <|-- Bar');
	assert(classType === 'class', 'No collision: class still detected');
	const ucType = detectDiagramType('@startusecase\nactor User\nusecase (Login)\nUser --> (Login)');
	assert(ucType === 'usecase', 'No collision: usecase still detected');
	const actType = detectDiagramType('start\n:Do thing;\nstop');
	assert(actType === 'activity', 'No collision: activity still detected');
	console.log('  No collision with existing types: OK');
}

{
	// Container conversion
	const result = convert(
		'node "Server" {\n' +
		'  [App] as app\n' +
		'  database "Cache" as cache\n' +
		'}\n' +
		'app --> cache'
	);
	assert(result.diagramType === 'component', 'Container pipeline: detected');
	assert(result.xml.includes('container=1'), 'Container pipeline: has container');
	assert(result.xml.includes('edge="1"'), 'Container pipeline: has edge');
	console.log('  Container conversion: OK');
}

{
	// Deployment elements conversion
	const result = convert(
		'node "App" as app\n' +
		'cloud "AWS" as aws\n' +
		'database "DB" as db\n' +
		'app --> db\n' +
		'aws --> app'
	);
	assert(result.diagramType === 'component', 'Deployment: detected');
	assert(result.xml.includes('box3d'), 'Deployment: node shape');
	assert(result.xml.includes('shape=cloud'), 'Deployment: cloud shape');
	assert(result.xml.includes('cylinder3'), 'Deployment: database shape');
	console.log('  Deployment elements: OK');
}

// ── State Parser Tests ───────────────────────────────────────────────────

section('State Parser');

// Basic state declarations
{
	const d = parseStateDiagram('state StateA');
	assert(d.elements.size === 1, 'Simple state: 1 element');
	assert(d.elements.has('StateA'), 'Simple state: code StateA');
	assert(d.elements.get('StateA').type === StateType.STATE, 'Simple state: type STATE');
	console.log('  Simple state declaration: OK');
}

{
	const d = parseStateDiagram('state "Long Name" as LN');
	assert(d.elements.has('LN'), 'Alias: code LN');
	assert(d.elements.get('LN').displayName === 'Long Name', 'Alias: display name');
	console.log('  Display-as-code alias: OK');
}

{
	const d = parseStateDiagram('state LN as "Long Name"');
	assert(d.elements.has('LN'), 'Reverse alias: code LN');
	assert(d.elements.get('LN').displayName === 'Long Name', 'Reverse alias: display name');
	console.log('  Code-as-display alias: OK');
}

{
	const d = parseStateDiagram('state StateA : entry / init\nstate StateA : do / process');
	const el = d.elements.get('StateA');
	assert(el.descriptions.length === 2, 'Inline desc: 2 descriptions');
	assert(el.descriptions[0] === 'entry / init', 'Inline desc: first');
	assert(el.descriptions[1] === 'do / process', 'Inline desc: second');
	console.log('  Inline descriptions: OK');
}

// Start/end pseudostates
{
	const d = parseStateDiagram('[*] --> StateA');
	assert(d.transitions.length === 1, 'Start transition: 1 transition');
	const fromCode = d.transitions[0].from;
	const fromEl = d.elements.get(fromCode);
	assert(fromEl.type === StateType.INITIAL, 'Start: initial type');
	assert(d.elements.has('StateA'), 'Start: auto-created target');
	console.log('  Start pseudostate [*] -->: OK');
}

{
	const d = parseStateDiagram('StateA --> [*]');
	const toCode = d.transitions[0].to;
	const toEl = d.elements.get(toCode);
	assert(toEl.type === StateType.FINAL, 'End: final type');
	console.log('  End pseudostate --> [*]: OK');
}

{
	const d = parseStateDiagram('[*] --> A\nA --> [*]');
	const types = [...d.elements.values()].map(e => e.type);
	assert(types.includes(StateType.INITIAL), 'Both: has initial');
	assert(types.includes(StateType.FINAL), 'Both: has final');
	assert(d.transitions.length === 2, 'Both: 2 transitions');
	console.log('  Both start and end: OK');
}

// Transitions with labels and directions
{
	const d = parseStateDiagram('A --> B : go next');
	assert(d.transitions[0].label === 'go next', 'Label: text');
	assert(d.transitions[0].from === 'A', 'Label: from');
	assert(d.transitions[0].to === 'B', 'Label: to');
	console.log('  Transition label: OK');
}

{
	const d = parseStateDiagram('A -left-> B');
	assert(d.transitions[0].direction === TransitionDirection.LEFT, 'Direction: left');
	console.log('  Direction left: OK');
}

{
	const d = parseStateDiagram('A -right-> B');
	assert(d.transitions[0].direction === TransitionDirection.RIGHT, 'Direction: right');
	console.log('  Direction right: OK');
}

{
	const d = parseStateDiagram('A -up-> B');
	assert(d.transitions[0].direction === TransitionDirection.UP, 'Direction: up');
	console.log('  Direction up: OK');
}

{
	const d = parseStateDiagram('A -down-> B');
	assert(d.transitions[0].direction === TransitionDirection.DOWN, 'Direction: down');
	console.log('  Direction down: OK');
}

{
	const d = parseStateDiagram('A -[dashed]-> B');
	assert(d.transitions[0].lineStyle === TransitionStyle.DASHED, 'Style: dashed');
	console.log('  Arrow style dashed: OK');
}

{
	const d = parseStateDiagram('A -[dotted]-> B');
	assert(d.transitions[0].lineStyle === TransitionStyle.DOTTED, 'Style: dotted');
	console.log('  Arrow style dotted: OK');
}

{
	const d = parseStateDiagram('A -[bold]-> B');
	assert(d.transitions[0].lineStyle === TransitionStyle.BOLD, 'Style: bold');
	console.log('  Arrow style bold: OK');
}

{
	const d = parseStateDiagram('A -[#red]-> B');
	assert(d.transitions[0].color === '#red', 'Color: #red');
	console.log('  Arrow color: OK');
}

{
	const d = parseStateDiagram('A -[#blue,dashed]-> B : label');
	assert(d.transitions[0].color === '#blue', 'Combined: color');
	assert(d.transitions[0].lineStyle === TransitionStyle.DASHED, 'Combined: style');
	assert(d.transitions[0].label === 'label', 'Combined: label');
	console.log('  Combined arrow style + color: OK');
}

{
	const d = parseStateDiagram('A ---> B');
	assert(d.transitions[0].arrowLength >= 3, 'Long arrow: length >= 3');
	console.log('  Long arrow: OK');
}

// Reverse arrows
{
	const d = parseStateDiagram('B <-- A : back');
	assert(d.transitions[0].from === 'A', 'Reverse: from A');
	assert(d.transitions[0].to === 'B', 'Reverse: to B');
	assert(d.transitions[0].label === 'back', 'Reverse: label');
	console.log('  Reverse arrow <--: OK');
}

// Composite states
{
	const d = parseStateDiagram('state Composite {\n  state Inner\n}');
	assert(d.elements.has('Composite'), 'Composite: exists');
	const comp = d.elements.get('Composite');
	assert(comp.children.length === 1, 'Composite: 1 child');
	assert(comp.children[0] === 'Inner', 'Composite: child is Inner');
	const inner = d.elements.get('Inner');
	assert(inner.parentCode === 'Composite', 'Composite: child parentCode');
	console.log('  Composite state: OK');
}

{
	const d = parseStateDiagram(
		'state Outer {\n  state Middle {\n    state Deep\n  }\n}'
	);
	const outer = d.elements.get('Outer');
	assert(outer.children.includes('Middle'), 'Nested: Outer has Middle');
	const middle = d.elements.get('Middle');
	assert(middle.children.includes('Deep'), 'Nested: Middle has Deep');
	const deep = d.elements.get('Deep');
	assert(deep.parentCode === 'Middle', 'Nested: Deep parent is Middle');
	console.log('  Nested composite: OK');
}

{
	const d = parseStateDiagram(
		'state Comp {\n  [*] --> A\n  A --> [*]\n}'
	);
	const comp = d.elements.get('Comp');
	assert(comp.childTransitions.length === 2, 'Composite transitions: 2 inner');
	// Verify inner [*] are scoped to Comp
	const initialCode = comp.childTransitions[0].from;
	assert(initialCode.includes('Comp'), 'Inner [*]: scoped to Comp');
	console.log('  Composite inner transitions: OK');
}

// begin/end state syntax
{
	const d = parseStateDiagram('state MyState begin\n  state Inner\nend state');
	assert(d.elements.has('MyState'), 'Begin/end: composite exists');
	const comp = d.elements.get('MyState');
	assert(comp.children.includes('Inner'), 'Begin/end: has child');
	console.log('  Begin/end state syntax: OK');
}

// Stereotypes
{
	const d = parseStateDiagram('state c1 <<choice>>');
	assert(d.elements.get('c1').type === StateType.CHOICE, 'Stereotype: choice');
	console.log('  Stereotype choice: OK');
}

{
	const d = parseStateDiagram('state f1 <<fork>>');
	assert(d.elements.get('f1').type === StateType.FORK_JOIN, 'Stereotype: fork');
	console.log('  Stereotype fork: OK');
}

{
	const d = parseStateDiagram('state j1 <<join>>');
	assert(d.elements.get('j1').type === StateType.FORK_JOIN, 'Stereotype: join');
	console.log('  Stereotype join: OK');
}

{
	const d = parseStateDiagram('state s1 <<start>>');
	assert(d.elements.get('s1').type === StateType.INITIAL, 'Stereotype: start');
	console.log('  Stereotype start: OK');
}

{
	const d = parseStateDiagram('state e1 <<end>>');
	assert(d.elements.get('e1').type === StateType.FINAL, 'Stereotype: end');
	console.log('  Stereotype end: OK');
}

{
	const d = parseStateDiagram('state h1 <<history>>');
	assert(d.elements.get('h1').type === StateType.HISTORY, 'Stereotype: history');
	console.log('  Stereotype history: OK');
}

{
	const d = parseStateDiagram('state dh1 <<history*>>');
	assert(d.elements.get('dh1').type === StateType.DEEP_HISTORY, 'Stereotype: deep history');
	console.log('  Stereotype deep history: OK');
}

{
	const d = parseStateDiagram('state custom <<MyService>>');
	const el = d.elements.get('custom');
	assert(el.type === StateType.STATE, 'Custom stereo: type STATE');
	assert(el.stereotypes.length === 1, 'Custom stereo: 1 stereotype');
	assert(el.stereotypes[0] === 'MyService', 'Custom stereo: text');
	console.log('  Custom stereotype: OK');
}

// Colors
{
	const d = parseStateDiagram('state Colored #LightBlue');
	assert(d.elements.get('Colored').color === '#LightBlue', 'Color: background');
	console.log('  Background color: OK');
}

{
	const d = parseStateDiagram('state Bordered ##red');
	assert(d.elements.get('Bordered').lineColor === 'red', 'Color: line color');
	console.log('  Line color: OK');
}

{
	const d = parseStateDiagram('state S1 ##[dashed]blue');
	const el = d.elements.get('S1');
	assert(el.lineColor === 'blue', 'Dashed border: line color');
	assert(el.lineStyle === 'dashed', 'Dashed border: line style');
	console.log('  Dashed border: OK');
}

// Add field (description)
{
	const d = parseStateDiagram('state S1\nS1 : field 1\nS1 : field 2');
	const el = d.elements.get('S1');
	assert(el.descriptions.length === 2, 'Add field: 2 lines');
	assert(el.descriptions[0] === 'field 1', 'Add field: first');
	assert(el.descriptions[1] === 'field 2', 'Add field: second');
	console.log('  Add field: OK');
}

// Notes
{
	const d = parseStateDiagram('state A\nnote left of A : my note');
	assert(d.notes.length === 1, 'Note single: 1 note');
	assert(d.notes[0].entityCode === 'A', 'Note single: entity');
	assert(d.notes[0].text === 'my note', 'Note single: text');
	assert(d.notes[0].position === StateNotePosition.LEFT, 'Note single: position');
	console.log('  Single-line note: OK');
}

{
	const d = parseStateDiagram('state A\nnote right of A\n  line 1\n  line 2\nend note');
	assert(d.notes.length === 1, 'Note multi: 1 note');
	assert(d.notes[0].text.includes('line 1'), 'Note multi: contains line 1');
	assert(d.notes[0].text.includes('line 2'), 'Note multi: contains line 2');
	console.log('  Multi-line note: OK');
}

{
	const d = parseStateDiagram('note "Floating" as N1');
	assert(d.notes.length === 1, 'Floating note: 1 note');
	assert(d.notes[0].alias === 'N1', 'Floating note: alias');
	assert(d.notes[0].text === 'Floating', 'Floating note: text');
	console.log('  Floating note: OK');
}

{
	const d = parseStateDiagram('A --> B\nnote on link : link note');
	assert(d.notes.length === 1, 'Note on link: 1 note');
	assert(d.notes[0].isOnLink === true, 'Note on link: isOnLink');
	assert(d.notes[0].text === 'link note', 'Note on link: text');
	console.log('  Note on link: OK');
}

// Concurrent regions
{
	const d = parseStateDiagram(
		'state Concurrent {\n  state A\n  --\n  state B\n}'
	);
	const el = d.elements.get('Concurrent');
	assert(el.concurrentRegions.length === 2, 'Concurrent: 2 regions');
	assert(el.concurrentRegions[0].elements.includes('A'), 'Concurrent: region 0 has A');
	assert(el.concurrentRegions[1].elements.includes('B'), 'Concurrent: region 1 has B');
	console.log('  Concurrent regions: OK');
}

{
	const d = parseStateDiagram(
		'state C {\n  state A\n  --\n  state B\n  --\n  state D\n}'
	);
	const el = d.elements.get('C');
	assert(el.concurrentRegions.length === 3, 'Three regions: 3');
	console.log('  Three concurrent regions: OK');
}

// History states
{
	const d = parseStateDiagram('[H] --> Target');
	const fromCode = d.transitions[0].from;
	assert(d.elements.get(fromCode).type === StateType.HISTORY, 'History: [H] type');
	console.log('  History state [H]: OK');
}

{
	const d = parseStateDiagram('[H*] --> Target');
	const fromCode = d.transitions[0].from;
	assert(d.elements.get(fromCode).type === StateType.DEEP_HISTORY, 'Deep history: [H*] type');
	console.log('  Deep history state [H*]: OK');
}

{
	const d = parseStateDiagram('state Parent {\n  state Child\n}\nParent[H] --> Child');
	const fromCode = d.transitions[0].from;
	assert(d.elements.get(fromCode).type === StateType.HISTORY, 'Named history: type');
	assert(fromCode.includes('Parent'), 'Named history: scoped to Parent');
	console.log('  Named history Parent[H]: OK');
}

// Synchro bars
{
	const d = parseStateDiagram('A --> ==sync1==\n==sync1== --> B');
	assert(d.elements.has('sync1'), 'Synchro: element exists');
	assert(d.elements.get('sync1').type === StateType.SYNCHRO_BAR, 'Synchro: type');
	assert(d.transitions.length === 2, 'Synchro: 2 transitions');
	console.log('  Synchro bar ==name==: OK');
}

// Direction
{
	const d = parseStateDiagram('left to right direction\nstate A');
	assert(d.direction === StateDiagramDirection.LEFT_TO_RIGHT, 'Direction: LTR');
	console.log('  Left to right direction: OK');
}

{
	const d = parseStateDiagram('top to bottom direction\nstate A');
	assert(d.direction === StateDiagramDirection.TOP_TO_BOTTOM, 'Direction: TTB');
	console.log('  Top to bottom direction: OK');
}

// Hide empty description
{
	const d = parseStateDiagram('hide empty description');
	assert(d.hideEmptyDescription === true, 'Hide empty: true');
	console.log('  Hide empty description: OK');
}

// Title
{
	const d = parseStateDiagram('title My State Diagram');
	assert(d.title === 'My State Diagram', 'Title: parsed');
	console.log('  Title: OK');
}

// ── State Emitter Tests ─────────────────────────────────────────────────

section('State Emitter');

{
	const d = parseStateDiagram('[*] --> Active\nActive --> [*]');
	const cells = emitStateDiagram(d, 'p1');
	assert(cells.length > 0, 'Emitter: produces cells');
	const hasRounded = cells.some(c => c.includes('rounded=1'));
	assert(hasRounded, 'Emitter: rounded rect for state');
	console.log('  Basic state emission: OK');
}

{
	const d = parseStateDiagram('[*] --> A');
	const cells = emitStateDiagram(d, 'p1');
	const hasBlackEllipse = cells.some(c => c.includes('ellipse') && c.includes('fillColor=#000000'));
	assert(hasBlackEllipse, 'Emitter: start = filled black ellipse');
	console.log('  Initial state shape: OK');
}

{
	const d = parseStateDiagram('A --> [*]');
	const cells = emitStateDiagram(d, 'p1');
	const hasFinalOuter = cells.some(c => c.includes('ellipse') && c.includes('strokeWidth=2'));
	assert(hasFinalOuter, 'Emitter: final = outer ellipse with strokeWidth');
	const hasFinalInner = cells.some(c => c.includes('ellipse') && c.includes('fillColor=#000000'));
	assert(hasFinalInner, 'Emitter: final = inner filled ellipse');
	console.log('  Final state shape (bullseye): OK');
}

{
	const d = parseStateDiagram('state c1 <<choice>>\nA --> c1');
	const cells = emitStateDiagram(d, 'p1');
	const hasRhombus = cells.some(c => c.includes('rhombus'));
	assert(hasRhombus, 'Emitter: choice = rhombus');
	console.log('  Choice diamond shape: OK');
}

{
	const d = parseStateDiagram('state fk <<fork>>\nA --> fk');
	const cells = emitStateDiagram(d, 'p1');
	const hasBar = cells.some(c => c.includes('fillColor=#000000') && c.includes('arcSize=50'));
	assert(hasBar, 'Emitter: fork = black bar');
	console.log('  Fork/join bar shape: OK');
}

{
	const d = parseStateDiagram('state h1 <<history>>\nA --> h1');
	const cells = emitStateDiagram(d, 'p1');
	const hasH = cells.some(c => c.includes('value="H"'));
	assert(hasH, 'Emitter: history = H label');
	console.log('  History shape: OK');
}

{
	const d = parseStateDiagram('state dh1 <<history*>>\nA --> dh1');
	const cells = emitStateDiagram(d, 'p1');
	const hasHStar = cells.some(c => c.includes('value="H*"'));
	assert(hasHStar, 'Emitter: deep history = H* label');
	console.log('  Deep history shape: OK');
}

{
	const d = parseStateDiagram('A --> B : go');
	const cells = emitStateDiagram(d, 'p1');
	const hasEdge = cells.some(c => c.includes('edge="1"'));
	assert(hasEdge, 'Emitter: edge cell exists');
	const hasLabel = cells.some(c => c.includes('edge="1"') && c.includes('go'));
	assert(hasLabel, 'Emitter: edge has label');
	console.log('  Edge with label: OK');
}

{
	const d = parseStateDiagram('state Comp {\n  state Inner\n}');
	const cells = emitStateDiagram(d, 'p1');
	const hasContainer = cells.some(c => c.includes('container=1'));
	assert(hasContainer, 'Emitter: composite = container');
	console.log('  Composite container: OK');
}

{
	const d = parseStateDiagram('state S1 : entry / init\nstate S1 : do / work');
	const cells = emitStateDiagram(d, 'p1');
	const hasSwimlane = cells.some(c => c.includes('shape=swimlane'));
	assert(hasSwimlane, 'Emitter: state with desc = swimlane');
	console.log('  State with descriptions (swimlane): OK');
}

// ── State Pipeline Tests ────────────────────────────────────────────────

section('State Pipeline');

{
	const input = '@startuml\n[*] --> Active\nActive --> Inactive\nInactive --> [*]\n@enduml';
	const result = convert(input);
	assert(result.diagramType === 'state', 'Pipeline: detected as state');
	assert(result.xml.includes('<mxfile>'), 'Pipeline: has mxfile');
	assert(result.xml.includes('mxCell'), 'Pipeline: has cells');
	console.log('  Basic pipeline: OK');
}

{
	const type = detectDiagramType('[*] --> Active\nActive --> [*]');
	assert(type === 'state', 'Detection: [*] transitions = state');
	console.log('  Detection by [*]: OK');
}

{
	const type = detectDiagramType('@startstate\nA --> B\n@endstate');
	assert(type === 'state', 'Detection: @startstate');
	console.log('  Detection by @startstate: OK');
}

{
	const type = detectDiagramType('state Active\nstate Inactive\n[*] --> Active');
	assert(type === 'state', 'Detection: state keyword + [*]');
	console.log('  Detection by state keyword + [*]: OK');
}

{
	// Should NOT collide with activity
	const type = detectDiagramType(':action1;\nstart\nstop');
	assert(type === 'activity', 'No collision: activity still detected');
	console.log('  No collision with activity: OK');
}

{
	// Should NOT collide with sequence
	const type = detectDiagramType('Alice -> Bob : hello\nBob -> Alice : hi');
	assert(type === 'sequence', 'No collision: sequence still detected');
	console.log('  No collision with sequence: OK');
}

{
	// Should NOT collide with class
	const type = detectDiagramType('class Foo {\n  +bar()\n}\nclass Baz');
	assert(type === 'class', 'No collision: class still detected');
	console.log('  No collision with class: OK');
}

{
	// Composite state pipeline
	const input = 'state Outer {\n  [*] --> Inner\n  Inner --> [*]\n}';
	const result = convert(input);
	assert(result.diagramType === 'state', 'Composite pipeline: detected as state');
	assert(result.xml.includes('container=1'), 'Composite pipeline: has container');
	console.log('  Composite state pipeline: OK');
}

{
	// State with stereotypes pipeline
	const input = 'state c1 <<choice>>\n[*] --> c1\nc1 --> A : yes\nc1 --> B : no';
	const result = convert(input);
	assert(result.diagramType === 'state', 'Stereo pipeline: detected');
	assert(result.xml.includes('rhombus'), 'Stereo pipeline: choice shape');
	console.log('  Choice stereotype pipeline: OK');
}

// ── Timing Parser Tests ──────────────────────────────────────────────────

section('Timing Parser');

{
	// Robust player declaration
	const input = 'robust "Web Server" as WS #LightBlue\n@0\nWS is Idle';
	const d = parseTimingDiagram(input);
	assert(d.players.length === 1, 'robust: 1 player');
	assert(d.players[0].type === PlayerType.ROBUST, 'robust: type');
	assert(d.players[0].displayName === 'Web Server', 'robust: displayName');
	assert(d.players[0].code === 'WS', 'robust: code');
	assert(d.players[0].color === '#LightBlue', 'robust: color');
	console.log('  Robust player declaration: OK');
}

{
	// Concise player declaration
	const input = 'concise "Client" as C\n@0\nC is Waiting';
	const d = parseTimingDiagram(input);
	assert(d.players.length === 1, 'concise: 1 player');
	assert(d.players[0].type === PlayerType.CONCISE, 'concise: type');
	assert(d.players[0].displayName === 'Client', 'concise: displayName');
	console.log('  Concise player declaration: OK');
}

{
	// Clock player declaration
	const input = 'clock "System Clock" as clk with period 10 pulse 5 offset 2';
	const d = parseTimingDiagram(input);
	assert(d.players.length === 1, 'clock: 1 player');
	assert(d.players[0].type === PlayerType.CLOCK, 'clock: type');
	assert(d.players[0].clockPeriod === 10, 'clock: period');
	assert(d.players[0].clockPulse === 5, 'clock: pulse');
	assert(d.players[0].clockOffset === 2, 'clock: offset');
	console.log('  Clock player declaration: OK');
}

{
	// Binary player declaration
	const input = 'binary "Enable" as EN\n@0\nEN is low';
	const d = parseTimingDiagram(input);
	assert(d.players.length === 1, 'binary: 1 player');
	assert(d.players[0].type === PlayerType.BINARY, 'binary: type');
	console.log('  Binary player declaration: OK');
}

{
	// Analog player declaration
	const input = 'analog "Voltage" between 0 and 5 as V\n@0\nV is 0';
	const d = parseTimingDiagram(input);
	assert(d.players.length === 1, 'analog: 1 player');
	assert(d.players[0].type === PlayerType.ANALOG, 'analog: type');
	assert(d.players[0].analogStart === 0, 'analog: start');
	assert(d.players[0].analogEnd === 5, 'analog: end');
	console.log('  Analog player declaration: OK');
}

{
	// Rectangle player declaration
	const input = 'rectangle "Status" as ST\n@0\nST is Init';
	const d = parseTimingDiagram(input);
	assert(d.players.length === 1, 'rectangle: 1 player');
	assert(d.players[0].type === PlayerType.RECTANGLE, 'rectangle: type');
	console.log('  Rectangle player declaration: OK');
}

{
	// Compact player
	const input = 'compact robust "Server" as S\n@0\nS is Idle';
	const d = parseTimingDiagram(input);
	assert(d.players[0].compact === true, 'compact: flag set');
	console.log('  Compact player: OK');
}

{
	// State definitions (short form)
	const input = 'robust "S" as S\nS has Idle, Running, Error\n@0\nS is Idle';
	const d = parseTimingDiagram(input);
	const p = d.players[0];
	assert(p.states.length >= 3, 'state-def: 3+ states');
	assert(p.states.indexOf('Idle') >= 0, 'state-def: Idle');
	assert(p.states.indexOf('Running') >= 0, 'state-def: Running');
	assert(p.states.indexOf('Error') >= 0, 'state-def: Error');
	console.log('  State definitions (short): OK');
}

{
	// Absolute state changes
	const input = 'robust "S" as S\n@0\nS is Idle\n@10\nS is Running\n@20\nS is Idle';
	const d = parseTimingDiagram(input);
	const changes = d.players[0].stateChanges;
	assert(changes.length === 3, 'abs-state: 3 changes');
	assert(changes[0].time === 0, 'abs-state: t0');
	assert(changes[0].state === 'Idle', 'abs-state: s0');
	assert(changes[1].time === 10, 'abs-state: t1');
	assert(changes[1].state === 'Running', 'abs-state: s1');
	assert(changes[2].time === 20, 'abs-state: t2');
	console.log('  Absolute state changes: OK');
}

{
	// Relative state changes via @PLAYER context
	const input = 'robust "S" as S\n@S\n0 is Idle\n+10 is Running\n+5 is Idle';
	const d = parseTimingDiagram(input);
	const changes = d.players[0].stateChanges;
	assert(changes.length === 3, 'rel-state: 3 changes');
	assert(changes[0].time === 0, 'rel-state: t0');
	assert(changes[1].time === 10, 'rel-state: t1');
	assert(changes[2].time === 15, 'rel-state: t2=15');
	console.log('  Relative state changes: OK');
}

{
	// Named time points
	const input = 'robust "S" as S\n@10 as :start\nS is Running\n@30 as :end\nS is Idle';
	const d = parseTimingDiagram(input);
	assert(d.timeAliases.get('start') === 10, 'named-time: start=10');
	assert(d.timeAliases.get('end') === 30, 'named-time: end=30');
	console.log('  Named time points: OK');
}

{
	// Time constraints
	const input = 'robust "S" as S\n@0\nS is Idle\n@10\nS is Running\n@0 <--> @10 : {10ms}';
	const d = parseTimingDiagram(input);
	assert(d.constraints.length === 1, 'constraint: 1 constraint');
	assert(d.constraints[0].time1 === 0, 'constraint: t1');
	assert(d.constraints[0].time2 === 10, 'constraint: t2');
	assert(d.constraints[0].label === '{10ms}', 'constraint: label');
	console.log('  Time constraints: OK');
}

{
	// Inter-player messages
	const input = 'robust "A" as A\nrobust "B" as B\n@0\nA is X\nB is Y\nA@10 --> B@15 : request';
	const d = parseTimingDiagram(input);
	assert(d.messages.length === 1, 'message: 1 message');
	assert(d.messages[0].fromPlayer === 'A', 'message: from');
	assert(d.messages[0].fromTime === 10, 'message: fromTime');
	assert(d.messages[0].toPlayer === 'B', 'message: to');
	assert(d.messages[0].toTime === 15, 'message: toTime');
	assert(d.messages[0].label === 'request', 'message: label');
	console.log('  Inter-player messages: OK');
}

{
	// Highlights
	const input = 'robust "S" as S\n@0\nS is Idle\nhighlight 10 to 20 #Gold : busy';
	const d = parseTimingDiagram(input);
	assert(d.highlights.length === 1, 'highlight: 1 highlight');
	assert(d.highlights[0].startTime === 10, 'highlight: start');
	assert(d.highlights[0].endTime === 20, 'highlight: end');
	assert(d.highlights[0].color === '#Gold', 'highlight: color');
	assert(d.highlights[0].caption === 'busy', 'highlight: caption');
	console.log('  Highlights: OK');
}

{
	// Notes
	const input = 'robust "S" as S\n@0\nS is Idle\nnote top of S : Server info';
	const d = parseTimingDiagram(input);
	assert(d.notes.length === 1, 'note: 1 note');
	assert(d.notes[0].position === TimingNotePosition.TOP, 'note: position');
	assert(d.notes[0].playerCode === 'S', 'note: player');
	assert(d.notes[0].text === 'Server info', 'note: text');
	console.log('  Notes: OK');
}

{
	// Global compact mode
	const input = 'mode compact\nrobust "S" as S\n@0\nS is Idle';
	const d = parseTimingDiagram(input);
	assert(d.compactMode === true, 'compact-global: flag');
	assert(d.players[0].compact === true, 'compact-global: player inherits');
	console.log('  Global compact mode: OK');
}

{
	// Hide time axis
	const input = 'hide time axis\nrobust "S" as S\n@0\nS is Idle';
	const d = parseTimingDiagram(input);
	assert(d.hideTimeAxis === true, 'hide-axis: flag');
	console.log('  Hide time axis: OK');
}

{
	// Title
	const input = 'title My Timing Diagram\nrobust "S" as S\n@0\nS is Idle';
	const d = parseTimingDiagram(input);
	assert(d.title === 'My Timing Diagram', 'title: text');
	console.log('  Title: OK');
}

{
	// Multiple players
	const input = [
		'robust "Server" as S',
		'concise "Client" as C',
		'clock "CLK" as clk with period 10',
		'binary "EN" as EN',
		'@0',
		'S is Idle',
		'C is Waiting',
		'EN is low',
		'@10',
		'S is Running',
		'C is Active',
		'EN is high',
	].join('\n');
	const d = parseTimingDiagram(input);
	assert(d.players.length === 4, 'multi: 4 players');
	assert(d.players[0].stateChanges.length === 2, 'multi: S has 2 changes');
	assert(d.players[1].stateChanges.length === 2, 'multi: C has 2 changes');
	assert(d.players[3].stateChanges.length === 2, 'multi: EN has 2 changes');
	console.log('  Multiple players: OK');
}

// ── Timing Emitter Tests ─────────────────────────────────────────────────

section('Timing Emitter');

{
	// Basic emit — one robust player with 2 state changes
	const input = 'robust "Server" as S\nS has Idle, Running\n@0\nS is Idle\n@10\nS is Running';
	const model = parseTimingDiagram(input);
	const cells = emitTimingDiagram(model, 'puml-grp-1');
	assert(cells.length > 0, 'emit: produces cells');

	const cellStr = cells.join('\n');
	assert(cellStr.includes('Server'), 'emit: player label');
	assert(cellStr.includes('edge="1"'), 'emit: has edges (waveform)');
	assert(cellStr.includes('vertex="1"'), 'emit: has vertices');
	console.log('  Basic robust emit: OK');
}

{
	// Clock emit
	const input = 'clock "CLK" as clk with period 10\n@0\n@40';
	const model = parseTimingDiagram(input);
	const cells = emitTimingDiagram(model, 'puml-grp-1');
	assert(cells.length > 0, 'clock-emit: produces cells');
	console.log('  Clock emit: OK');
}

{
	// Highlight emit
	const input = 'robust "S" as S\n@0\nS is Idle\n@20\nS is Done\nhighlight 0 to 20 #Gold : test';
	const model = parseTimingDiagram(input);
	const cells = emitTimingDiagram(model, 'puml-grp-1');
	const cellStr = cells.join('\n');
	assert(cellStr.includes('opacity'), 'hl-emit: has opacity (highlight)');
	assert(cellStr.includes('test'), 'hl-emit: has caption');
	console.log('  Highlight emit: OK');
}

{
	// Message emit
	const input = 'robust "A" as A\nrobust "B" as B\n@0\nA is X\nB is Y\nA@10 --> B@15 : req';
	const model = parseTimingDiagram(input);
	const cells = emitTimingDiagram(model, 'puml-grp-1');
	const cellStr = cells.join('\n');
	assert(cellStr.includes('req'), 'msg-emit: has label');
	assert(cellStr.includes('endArrow=block'), 'msg-emit: has arrow');
	console.log('  Message emit: OK');
}

// ── Timing Pipeline Tests ────────────────────────────────────────────────

section('Timing Pipeline');

{
	// Detection
	const input = 'robust "Server" as S\nconcise "Client" as C\n@0\nS is Idle\nC is Waiting';
	const dt = detectDiagramType(input);
	assert(dt === 'timing', 'detect: timing');
	console.log('  Detection: OK');
}

{
	// Detection with clock
	const input = 'clock clk with period 10\n@0\n@40';
	const dt = detectDiagramType(input);
	assert(dt === 'timing', 'detect-clock: timing');
	console.log('  Detection (clock): OK');
}

{
	// Detection with binary
	const input = 'binary "EN" as EN\n@0\nEN is low\n@10\nEN is high';
	const dt = detectDiagramType(input);
	assert(dt === 'timing', 'detect-binary: timing');
	console.log('  Detection (binary): OK');
}

{
	// Detection with analog
	const input = 'analog "Voltage" between 0 and 5 as V\n@0\nV is 0\n@10\nV is 3.5';
	const dt = detectDiagramType(input);
	assert(dt === 'timing', 'detect-analog: timing');
	console.log('  Detection (analog): OK');
}

{
	// Full pipeline
	const input = 'robust "Server" as S\n@0\nS is Idle\n@10\nS is Running\n@20\nS is Idle';
	const result = convert(input);
	assert(result.diagramType === 'timing', 'pipeline: type');
	assert(result.xml.includes('<mxfile>'), 'pipeline: mxfile');
	assert(result.xml.includes('UserObject'), 'pipeline: UserObject');
	assert(result.xml.includes('Server'), 'pipeline: player label');
	console.log('  Full pipeline: OK');
}

{
	// Timing not misdetected as state
	const input = 'robust "S" as S\n@0\nS is Idle\n@10\nS is Running';
	const dt = detectDiagramType(input);
	assert(dt === 'timing', 'timing-not-state: correct detection');
	console.log('  Timing vs state detection: OK');
}

// ── Summary ──────────────────────────────────────────────────────────────

section('Results');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
	process.exit(1);
}
