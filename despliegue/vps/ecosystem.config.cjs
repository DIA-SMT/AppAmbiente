// pm2 de Residuos SMT en la VPS. Va en /srv/ambiente/ecosystem.config.cjs.
//
// Sólo la app: la base sigue en Supabase (DATABASE_URL en compartido/.env).
// El puerto es el primero libre de la tabla de la guía al 25/11/2026; antes de
// usarlo hay que confirmarlo en el servidor (ver README.md, paso 0).
module.exports = {
  apps: [{
    name: 'ambiente',
    cwd: '/srv/ambiente/actual',
    script: 'node_modules/next/dist/bin/next',
    // -H 127.0.0.1: sólo escucha adentro; todo entra por nginx.
    args: 'start -p 3010 -H 127.0.0.1',
    env: { NODE_ENV: 'production' },
    max_memory_restart: '700M',
    error_file: '/srv/ambiente/registros/error.log',
    out_file: '/srv/ambiente/registros/salida.log',
  }],
}
