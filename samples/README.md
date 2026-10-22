# Golden sample flows

Flows used by the tests at every level (validation, route behaviour, editor, pipeline).

- `flows/orders/`: POST `/orders` takes an order as JSON, the Kaoto DataMapper maps it to the
  fulfilment service's request, the flow calls that service over HTTP and maps its answer back.
  `sample-request.json` is a request to try it with.
- `flows/greetings/`: a contract-first flow as the Builder publishes it (REST from its OpenAPI
  spec, Base Path `/greetings`). `GET /greetings/{name}` answers a greeting; `DELETE` has no route,
  so ECHO's generated route answers 404. The pipeline's bundle build puts it in one image with orders.
- `mock-downstream/`: a Camel route that pretends to be the fulfilment service.

Run it locally with Camel JBang (4.22.1):

```bash
camel run mock-downstream/fulfilment-mock.camel.yaml --port=9090 --quarkus-version=3.36.0
cd flows/orders
camel run orders.camel.yaml kaoto-datamapper-*.xsl application.properties --port=8085 --quarkus-version=3.36.0
curl -XPOST localhost:8085/orders -H 'Content-Type: application/json' -d @sample-request.json
```
