import { Entry } from "@napi-rs/keyring";

// The Last.fm password is kept in the system's credential store (Windows Credential Manager,
// macOS Keychain or a Linux Secret Service keyring) under this name and the Last.fm username, instead of in .env.
export const CREDENTIAL_SERVICE = "lastfm-unscrobbler";

const entryFor = (username: string) => new Entry(CREDENTIAL_SERVICE, username);

export const readStoredPassword = (username: string) => entryFor(username).getPassword() ?? undefined;

export const storePassword = (username: string, password: string) => entryFor(username).setPassword(password);
