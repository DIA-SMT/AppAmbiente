# Residuos SMT en la VPS

Cómo mudar la **app** de Vercel a la VPS de la Dirección (195.35.42.168). La
**base sigue en Supabase**: por ahora se muda sólo el front. Es la guía «Migrar
proyectos a la VPS» aplicada a este proyecto, sin los pasos de la base (2) ni
de los respaldos (9).

| | |
|---|---|
| Nombre corto (usuario, carpeta) | `ambiente` |
| Puerto | `3010` (confirmar en el paso 0) |
| Dominio provisorio | `ambiente.195-35-42-168.sslip.io` |
| Repositorio | `DIA-SMT/AppAmbiente`, rama `main` |

Todo se corre como root por SSH. Los comandos largos no se mandan desde
PowerShell (se come las comillas): se entra al servidor y se corren ahí.

## 0 · Confirmar que el nombre y el puerto están libres

```bash
id ambiente                         # tiene que decir «no such user»
ss -ltnp | grep ':3010 '            # no tiene que mostrar nada
grep -rn 3010 /etc/nginx/sites-available /srv/*/ecosystem.config.*
```

Si el 3010 está tomado, usar el siguiente libre y cambiarlo en
`ecosystem.config.cjs` y en `nginx-ambiente.conf` (dos lugares).

## 1 · Usuario y carpetas

```bash
adduser --system --group --home /srv/ambiente --shell /bin/bash ambiente
mkdir -p /srv/ambiente/{versiones,compartido,registros}
chown -R ambiente:ambiente /srv/ambiente
chmod 751 /srv/ambiente          # el 1 final: si no, nginx no sirve los estilos
chmod 750 /srv/ambiente/compartido
```

## 2 · Variables de entorno

```bash
install -o ambiente -g ambiente -m 600 /dev/null /srv/ambiente/compartido/.env
nano /srv/ambiente/compartido/.env
```

Los nombres están en [`env.ejemplo`](env.ejemplo). Lo importante:

- `DATABASE_URL`: la **misma** cadena del pooler de Supabase (puerto 6543)
  que tiene Vercel. Sin ella la app arranca igual, pero con una base vacía en
  el disco y sin avisar.
- `AUTH_SECRET`: una **nueva**, generada en el servidor con
  `openssl rand -base64 48`. No la de Vercel.

## 3 · Traer el script y la configuración de pm2

```bash
cd /srv/ambiente
B=https://raw.githubusercontent.com/DIA-SMT/AppAmbiente/main/despliegue/vps
curl -fsSL "$B/desplegar.sh"         -o desplegar.sh
curl -fsSL "$B/ecosystem.config.cjs"  -o ecosystem.config.cjs
chown ambiente:ambiente ecosystem.config.cjs
chmod 700 desplegar.sh
```

## 4 · Primer despliegue y arranque automático

```bash
bash /srv/ambiente/desplegar.sh

# Una sola vez: que pm2 vuelva solo si el servidor se reinicia.
cd /srv/ambiente
pm2 startup systemd -u ambiente --hp /srv/ambiente
sudo -u ambiente pm2 kill            # el demonio que quedó del primer start
systemctl enable --now pm2-ambiente
systemctl status pm2-ambiente --no-pager

# Tiene que decir 127.0.0.1:3010, no *:3010 ni 0.0.0.0:3010.
ss -ltnp | grep ':3010 '
```

## 5 · nginx y certificado

```bash
curl -fsSL "$B/nginx-ambiente.conf" -o /etc/nginx/sites-available/ambiente
ln -s /etc/nginx/sites-available/ambiente /etc/nginx/sites-enabled/ambiente
nginx -t && systemctl reload nginx
certbot --nginx -d ambiente.195-35-42-168.sslip.io
```

Después, adentro del bloque 443 que escribió certbot, pegar las líneas que
están al final de [`nginx-ambiente.conf`](nginx-ambiente.conf) («PARA EL
BLOQUE 443») y volver a correr `nginx -t && systemctl reload nginx`.

## 6 · Verificar

```bash
D=ambiente.195-35-42-168.sslip.io
curl -sI "https://$D/ingresar" | head -1                                # 200
CSS=$(curl -s "https://$D/ingresar" | grep -o '/_next/static/[^"]*\.css' | head -1)
curl -sI "https://$D$CSS" | head -1                                     # 200, no 403
for r in /.env /.env.local /.git/config /package.json; do
  printf "%-16s " "$r"; curl -s -o /dev/null -w "%{http_code}\n" "https://$D$r"   # 404
done
curl -s "https://$D/api/salud"     # {"estado":"ok", …}
```

**Que esté usando Supabase y no una base vacía.** Fuera de Vercel, si falta
`DATABASE_URL` la app no se queja: arranca con PGlite en el disco y
`/api/salud` igual dice `ok`. Para estar seguro, entrar en el navegador como
coordinación y abrir `https://ambiente.195-35-42-168.sslip.io/api/salud`: con
sesión muestra el detalle, y tiene que decir `"motor": "postgres"` y
`"conecta": true`. Otra señal: el tablero muestra los movimientos de siempre.

Después, entrar con un punto y con coordinación, ver el tablero con Migue y
cargar un movimiento de prueba que después se anula.

## Los despliegues siguientes

```bash
bash /srv/ambiente/desplegar.sh          # el último commit de main
bash /srv/ambiente/desplegar.sh volver   # vuelve a la versión anterior
```

## Después de mudarse

- **Vercel sigue andando** contra la misma base hasta que la VPS esté
  verificada. Recién ahí se avisa a los puntos y a la coordinación la dirección
  nueva (las sesiones no pasan de un dominio a otro: hay que entrar de nuevo
  una vez) y se apaga Vercel.
- **Que la base no se duerma**: el workflow `mantener-base-despierta` le pega a
  Vercel. Al apagarlo, cargar en GitHub la variable `URL_PRODUCCION` con la
  dirección nueva (Settings → Secrets and variables → Actions → Variables).
  Sirve sólo si la VPS de verdad usa Supabase (ver el paso 6): con PGlite
  contestaría «ok» sin tocar la base.
- **Dominio real**: cuando sistemas delegue el subdominio, se agrega al
  `server_name` y se reemite el certificado con los dos nombres.
- **Respaldos**: siguen siendo los de Supabase mientras la base esté allá. Al
  mudar la base, se agregan los pasos 2 y 9 de la guía.
