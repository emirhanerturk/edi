// Keep tests isolated from the user's global git config (hooks, signing, colour).
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
