// seed:demo (SPEC §20.2) is built in Milestone 15. See docs/PROGRESS.md "Known gaps".
if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
  console.error('seed:demo refuses to run with NODE_ENV=production (pass --force to override).');
  process.exit(1);
}
console.log('seed:demo: not implemented yet (Milestone 15).');
