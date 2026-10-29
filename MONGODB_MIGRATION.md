# MongoDB runtime and DevX Control

The server implements the same storage interface on MongoDB, PostgreSQL, and the local Netlify blob store. MongoDB is selected when `MONGO_URI`, `MONGODB_URI`, or `MONGO_URL` is set, or when `DATABASE_URL` / `POSTGRES_URL` begins with `mongodb://` or `mongodb+srv://`. An explicit Mongo variable takes precedence over leftover PostgreSQL variables. `useSqlStore()` remains an explicit PostgreSQL override for the PostgreSQL test adapter.

DevX Control's migration flow supplies `MONGO_URI`; the runtime reads this variable. Keep its connection string in DevX's environment settings, never in Git. Set the URI database name to `exotic_cars`. The Mongo adapter stores app records in the `kv` collection and imports existing `cars`, `brands`, `products`, `meta`, and `system` collections at first connection when the app catalog is not initialized. Catalog changes also refresh those collections.

## Switching in DevX Control

Merging DevX's generated GitHub pull request does not itself change the running database. After this code is deployed, use the app's **Switch to MongoDB** action in DevX Control to copy the current data and set `MONGO_URI`. The app's `/api/v1/health` response reports `storageKind: "mongo"` and `storage: "ok"` when it can read the selected database. Keep the previous database until DevX's migration checks pass.

For manual deployment, set `MONGO_URI` in the server environment before restarting the app. An explicit Mongo variable intentionally prevents fallback to Postgres, so an invalid URI fails health checks instead of silently writing to another database.
