/**
 * Test suite for the PlantUML-to-draw.io converter.
 * Run with: node --experimental-vm-modules test.js
 */

import { convert, extractPlantUml, regenerate, detectDiagramType } from './PlantUmlImporter.js';
import { parseArrow, parseStyle } from './ArrowParser.js';
import { parseSequenceDiagram } from './SequenceParser.js';
import {
	ArrowHead, ArrowBody, ArrowPart, ArrowDecoration,
	Message, ExoMessage, LifeEvent, Fragment, Note, Divider, Delay, HSpace, Reference, Box,
	LifeEventType, GroupingType, NotePosition, NoteStyle
} from './SequenceModel.js';

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

// ── Summary ──────────────────────────────────────────────────────────────

section('Results');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed > 0) {
	process.exit(1);
}
