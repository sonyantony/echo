I am building an application called ECHO for EY (ey.com).

VERSION 1 (development to start immediately)

The application has two components: the ECHO Builder and the ECHO Runtime Engine.

- The Runtime Engine is based on Apache Camel K and runs integration routes defined in the Camel YAML DSL.
- The Builder will be used by developers and subject-matter experts to design these flows. It will generate the YAML DSL routes and publish them to GitHub (or another version control system), where Jenkins (or another CI/CD pipeline) will pick them up and build them.
- The Builder's front end should be web-based and use drag and drop.
- I would like to reuse existing software and libraries, such as Kaoto, but only where doing so makes development easier.
- Most of the code will be generated using Claude Code.
- The team is very familiar with Java and Spring Boot, but familiarity should not be the only deciding factor.

Version 1 decisions

- Version 1 is a demo prototype.
- The Builder's drag-and-drop editor embeds Kaoto.
- The Runtime uses exported Camel apps (Camel JBang export to Spring Boot), built by the buyer's own pipeline and deployed as containers, rather than the Camel K operator.
- EY will sell ECHO through a marketplace. Each buyer self-hosts ECHO and uses their own pipeline, which also controls approvals and promotion between environments. ECHO must not depend on a specific Git provider, CI tool, cloud, login system or secrets store; Jenkins is one supported option.
- The Builder has its own login screen. In Version 1, users are configured in the Builder backend's application.yaml. Later, buyers or EY will connect their own authentication, including SSO.
- Secrets are kept in application.yaml in Version 1.
- The Builder will store its own data in an H2 database running in file mode (embedded), while the flows themselves are stored in Git.
- Expected load is low, about 10 concurrent Builder users.

VERSION 2

In a later version, I would like to add a schema editor to the Builder, as follows:

- An OpenAPI-based schema editor that can be used in the browser.
- The Runtime will be enhanced to provide a Swagger UI that shows the format of incoming and outgoing messages.
- The Runtime will validate each incoming request against its schema and reject any message that fails validation.

What software technologies and libraries would you recommend to build this?
