import { routeForOperation } from '../apispec/operationIds';
import { scaffoldAttention, stepProblems } from './stepProblems';

const yaml = [
  '- route:', //                                1
  '    id: get-node', //                        2
  '    from:', //                               3
  '      uri: platform-http:/node', //          4
  '      steps:', //                            5
  '        - setVariable:', //                  6
  '            name: id', //                    7
  '        - multicast:', //                    8
  '            steps:', //                      9
  '              - pipeline:', //               10
  '                  steps:', //                11
  '                    - to:', //               12
  '                        uri: rest-openapi', // 13
  '        - choice:', //                       14
  '            when:', //                       15
  '              - simple: ${body}', //         16
  '                steps:', //                  17
  '                  - log:', //                18
  '                      message: hi', //       19
  '            otherwise:', //                  20
  '              steps:', //                    21
  '                - setBody:', //              22
  '                    constant: x', //         23
  '',
].join('\n');

const at = (line: number | null, file = 'get-node.camel.yaml') => ({ file, line, message: `line ${line}` });

describe('stepProblems', () => {
  it('puts each problem on the innermost step holding its line', () => {
    const { steps, other } = stepProblems([at(7), at(13), at(12), at(19), at(23), at(16)], 'get-node.camel.yaml', yaml);
    expect(other).toEqual([]);
    expect(Object.fromEntries([...steps].map(([id, list]) => [id, list.map((p) => p.line)]))).toEqual({
      'get-node|route.from.steps.0.setVariable': [7],
      'get-node|route.from.steps.1.multicast.steps.0.pipeline.steps.0.to': [13, 12],
      'get-node|route.from.steps.2.choice.when.0.steps.0.log': [19],
      'get-node|route.from.steps.2.choice.otherwise.steps.0.setBody': [23],
      'get-node|route.from.steps.2.choice.when.0': [16],
    });
  });

  it('puts problems with the route itself on its from', () => {
    const { steps } = stepProblems([at(2), at(4)], 'get-node.camel.yaml', yaml);
    expect([...steps.keys()]).toEqual(['get-node|route.from']);
  });

  it('leaves problems of other files, without a line or in unreadable YAML for elsewhere', () => {
    const problems = [at(4, 'application.properties'), at(null), at(99)];
    expect(stepProblems(problems, 'get-node.camel.yaml', yaml).other).toEqual(problems);
    expect(stepProblems([at(2)], 'get-node.camel.yaml', '- route: [').other).toHaveLength(1);
  });
});

describe('scaffoldAttention', () => {
  const made = routeForOperation(
    { method: 'GET', path: '/cards/{id}', operationId: 'getCardsId', parameters: [{ name: 'id', in: 'path' }] },
    { specificationUri: 'blueplanet.openapi.json' },
  );
  const pipeline = 'route-getCardsId|route.from.steps.3.multicast.steps.0.pipeline';

  it('marks the steps of a new scaffold the user still has to work on', () => {
    const todo = scaffoldAttention(made);
    expect([...todo.keys()]).toEqual([
      `${pipeline}.steps.0.setHeaders`,
      `${pipeline}.steps.1.to`,
      `${pipeline}.steps.3.setBody`,
      'route-getCardsId|route.from.steps.5.step',
    ]);
    expect(todo.get(`${pipeline}.steps.1.to`)).toEqual(['Pick the operation this step calls: Operation Id.']);
  });

  it('lets each go once the user has done it', () => {
    const done = made
      .replace('specificationUri: blueplanet.openapi.json', 'specificationUri: blueplanet.openapi.json\n                          operationId: getCard')
      .replace('"result": ${body}', '"card": ${body}')
      .replace('uri: xslt-saxon', 'uri: xslt-saxon:kaoto-datamapper-1.xsl');
    expect([...scaffoldAttention(done).keys()]).toEqual([`${pipeline}.steps.0.setHeaders`]);
    // Any change to the headers: here the id header renamed as the operation names it.
    expect(scaffoldAttention(done.replace('- name: id\n', '- name: cardId\n')).size).toBe(0);
  });
});
