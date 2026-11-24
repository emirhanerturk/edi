// Testler kullanıcının global git ayarlarından (hook, imzalama, renk) etkilenmesin.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';
process.env.GIT_CONFIG_NOSYSTEM = '1';
