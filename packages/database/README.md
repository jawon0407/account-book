# Database Package

The package exports the typed `app_private` authentication tables and a per-call
Drizzle node-postgres client factory. The matching SQL migration is the source
of truth for PostgreSQL privileges and constraints.
