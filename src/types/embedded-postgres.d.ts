/**
 * Minimal ambient types for the optional `embedded-postgres` package (installed
 * only in the desktop/home build). Lets the runtime module typecheck in the main
 * workspace without pulling the platform Postgres binary in here.
 * Real package: https://www.npmjs.com/package/embedded-postgres
 */
declare module "embedded-postgres" {
  export interface EmbeddedPostgresOptions {
    databaseDir?: string;
    user?: string;
    password?: string;
    port?: number;
    persistent?: boolean;
    initdbFlags?: string[];
    postgresFlags?: string[];
    onLog?: (message: string) => void;
    onError?: (error: Error) => void;
  }
  export default class EmbeddedPostgres {
    constructor(options?: EmbeddedPostgresOptions);
    initialise(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    createDatabase(name: string): Promise<void>;
    dropDatabase(name: string): Promise<void>;
  }
}
