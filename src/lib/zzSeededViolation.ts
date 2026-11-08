// MPC-9884 SEEDED VIOLATION: proves the registry scan fails CI. Removed in the next commit.
export const seededViolation = () => fetch("https://tracker.seeded-violation.example.net/p");
