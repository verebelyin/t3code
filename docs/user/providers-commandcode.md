# Command Code

Command Code runs on the environment's machine. Web, desktop, and mobile clients
can use the same provider through that environment.

Install Node.js 22 or newer, then install and sign in to Command Code:

```bash
npm install -g command-code
command-code login
```

T3 Code requires Command Code 1.74.0 or newer. Open **Settings → Providers** in
the web or desktop app, select your environment, and add a **Command Code**
instance. If the executable is not on the server's `PATH`, set its **Binary path**.

For a separate account, add another instance and set `COMMAND_CODE_API_KEY` in
its environment variables. Mark the value as sensitive. Instances without an
explicit key share the Command Code login saved on that machine.

Choose a model from the thread's model selector. Models and reasoning effort
choices come from the installed CLI and project configuration. **Plan** uses
Command Code's native plan mode. **Auto** falls back to asking for approval.
Questions offer the choices supplied by Command Code. Switch plan mode with the
composer toggle; the agent is told not to enter it on its own. If a model keeps
repeating the same tool call, T3 Code stops the turn with an error. Retry with a
different model.

Images are supported; audio attachments are not. Restoring a T3 checkpoint
restores workspace files, but does not rewind Command Code's native conversation.

Automatic titles, branch names, commit messages, and change request descriptions
are unavailable with this provider. Choose another provider for generated Git text.

Update the CLI with the package manager you used to install it. Sign-in and
updates belong on the environment's machine, including when you connect remotely.
