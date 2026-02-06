/**
 * Generate a sample .drawio file from a complex PlantUML sequence diagram.
 */

import { convert } from './PlantUmlImporter.js';
import { writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const plantUml = `@startuml
title E-Commerce Order Processing

actor Customer
participant "Web App" as Web
participant "Order Service" as Orders
participant "Payment Gateway" as Payment
database "Order DB" as DB
participant "Notification Service" as Notify

== Place Order ==

Customer -> Web : Add to cart
Customer -> Web : Checkout

Web -> Orders : createOrder(items, customer)
activate Orders

Orders -> DB : saveOrder(pending)
activate DB
DB --> Orders : orderId
deactivate DB

Orders -> Payment : processPayment(amount, card)
activate Payment

alt payment success
  Payment --> Orders : paymentConfirmed

  Orders -> DB : updateStatus(paid)

  Orders -> Notify : sendConfirmation(orderId)
  activate Notify
  Notify --> Customer : Order confirmation email
  deactivate Notify

  Orders --> Web : orderConfirmed(orderId)
else payment failed
  Payment --> Orders : paymentDeclined(reason)

  Orders -> DB : updateStatus(failed)
  Orders --> Web : orderFailed(reason)

  Web --> Customer : Payment error message
end

deactivate Payment
deactivate Orders

== Order Fulfillment ==

... 2 hours later ...

ref over Orders, DB : Inventory check & allocation

Orders -> Notify : sendShippingUpdate(orderId)
activate Notify
Notify --> Customer : Shipping notification
deactivate Notify

note right of Orders : Order moves to\\nfulfillment queue

Orders -> Orders : processShipment()

== Delivery ==

note over Customer, Notify
  Customer receives package
  and confirms delivery
end note

Customer -> Web : confirmDelivery(orderId)
Web -> Orders : markDelivered(orderId)
Orders -> DB : updateStatus(delivered)

destroy Payment
@enduml`;

const result = convert(plantUml);

writeFileSync(join(__dirname, 'plantuml-import-sample.drawio'), result.xml);
writeFileSync(join(__dirname, 'plantuml-import-sample.puml'), plantUml);
console.log('Generated: plantuml-import-sample.drawio');
console.log('Generated: plantuml-import-sample.puml');
console.log(`Diagram type: ${result.diagramType}`);
console.log(`XML length: ${result.xml.length} chars`);

// Also generate a simple one
const simplePuml = `@startuml
Alice -> Bob : hello
Bob --> Alice : hi there
@enduml`;
const simple = convert(simplePuml);

writeFileSync(join(__dirname, 'plantuml-simple-sample.drawio'), simple.xml);
writeFileSync(join(__dirname, 'plantuml-simple-sample.puml'), simplePuml);
console.log('\nGenerated: plantuml-simple-sample.drawio');
console.log('Generated: plantuml-simple-sample.puml');
