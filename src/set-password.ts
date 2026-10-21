import { CREDENTIAL_SERVICE, readStoredPassword, storePassword } from "./credentials.ts";

// Stores the Last.fm password in the system's credential store, typed in without being shown.
const USERNAME = process.env.LASTFM_USERNAME;
if (!USERNAME) {
  console.error("LASTFM_USERNAME must be set in .env first; the password is stored under it.");
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error("Run this in a terminal, so the password can be typed without being shown.");
  process.exit(1);
}

// Reads one line from the terminal without echoing it; Ctrl+C cancels.
const promptHidden = (question: string) =>
  new Promise<string>((resolve, reject) => {
    const stdin = process.stdin;
    let input = "";
    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          finish();
          resolve(input);
          return;
        }
        if (char === "\u0003") {
          finish();
          reject(new Error("Cancelled; nothing was stored."));
          return;
        }
        input = char === "\u007f" || char === "\b" ? input.slice(0, -1) : input + char;
      }
    };
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });

try {
  if (readStoredPassword(USERNAME) !== undefined) {
    console.log(`A password is already stored for ${USERNAME}; this will replace it.`);
  }
  const password = await promptHidden(`Last.fm password for ${USERNAME}: `);
  if (password === "") {
    throw new Error("No password typed; nothing was stored.");
  }
  if ((await promptHidden("Type it again to confirm: ")) !== password) {
    throw new Error("The two passwords didn't match; nothing was stored.");
  }
  storePassword(USERNAME, password);
  if (readStoredPassword(USERNAME) !== password) {
    throw new Error("The password was stored but didn't read back the same; try again.");
  }
  console.log(
    `Stored in your system's credential store as "${CREDENTIAL_SERVICE}" for ${USERNAME}. You can now remove LASTFM_PASSWORD from .env.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
