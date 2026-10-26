// A fake Jira Cloud for the e2e tests (Import From Jira): one story, PAY-142, with its examples in
// the description and a corrected response in a comment. Run by playwright.config.ts.
import { createServer } from 'node:http';

const port = Number(process.env.ECHO_E2E_JIRA_PORT ?? 8199);
const adf = (...content) => ({ type: 'doc', version: 1, content });
const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const code = (text) => ({ type: 'codeBlock', attrs: { language: 'json' }, content: [{ type: 'text', text }] });

const answers = {
  '/rest/api/3/issue/PAY-142': {
    key: 'PAY-142',
    fields: {
      summary: 'Pay a bill from an account',
      description: adf(
        para('As a customer I can pay a bill from one of my accounts.'),
        para('Endpoint: POST /accounts/{accountId}/payments'),
        para('Sample request:'),
        code('{\n  "amount": { "value": 125.5, "currency": "EUR" },\n  "payee": "Electric Co",\n  "reference": null\n}'),
        para('Sample response:'),
        code('{ "paymentId": "p-981", "status": "PENDING" }'),
        para('Customers can list their payments: GET /accounts/{accountId}/payments?status=PENDING&limit=20'),
        para('Response:'),
        code('[{ "paymentId": "p-981", "status": "PENDING", "createdAt": "2026-10-20T09:15:00Z" }]'),
      ),
    },
  },
  '/rest/api/3/issue/PAY-142/comment': {
    startAt: 0,
    maxResults: 100,
    total: 1,
    comments: [
      {
        author: { displayName: 'Priya Shah' },
        created: '2026-10-14T09:12:00.000+0000',
        body: adf(para('Correction after the API review, POST /accounts/{accountId}/payments response:'),
          code('{ "paymentId": "p-981", "status": "PENDING", "expectedBy": "2026-10-22" }')),
      },
    ],
  },
};

createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/health') return res.end('ok');
  const body = answers[path];
  res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body ?? { errorMessages: ['Issue does not exist'] }));
}).listen(port, '127.0.0.1');
