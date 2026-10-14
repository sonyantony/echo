I am building an application called ECHO for EY (ey.com).

VERSION 1 (development to start immediately)

The application has two components: the ECHO Builder and the ECHO Runtime Engine.

- The Runtime Engine is based on Apache Camel K and runs integration routes defined in the Camel YAML DSL.
- The Builder will be used by developers and subject-matter experts to design these flows. It will generate the YAML DSL routes and publish them to GitHub (or another version control system), where Jenkins (or another CI/CD pipeline) will pick them up and build them.
- The Builder's front end should be web-based and use drag and drop.
- The Builder will store its own data in an H2 database running in file mode (embedded), while the flows themselves are stored in Git.
- I would like to reuse existing software and libraries, such as Kaoto, but only where doing so makes development easier.
- Most of the code will be generated using Claude Code.
- The team is very familiar with Java and Spring Boot, but familiarity should not be the only deciding factor.

VERSION 2

In a later version, I would like to add a schema editor to the Builder, as follows:

- An OpenAPI-based schema editor that can be used in the browser.
- The Runtime will be enhanced to provide a Swagger UI that shows the format of incoming and outgoing messages.
- The Runtime will validate each incoming request against its schema and reject any message that fails validation.

What software technologies and libraries would you recommend to build this?
