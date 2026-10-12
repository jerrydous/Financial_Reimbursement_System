#!/bin/sh
# 需要本机已经 docker compose up，并且 Keycloak、API 可访问。
set -eu
KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8088}"
API_URL="${API_URL:-http://localhost:3000}"
USER_NAME="${KEYCLOAK_DEV_USER:-employee1}"
PASSWORD="${KEYCLOAK_DEV_PASSWORD:-employee1}"

unauth=$(curl -s -o /tmp/frs-unauth.json -w "%{http_code}" "$API_URL/me")
if [ "$unauth" != "401" ]; then
  echo "未登录应返回 401，实际 $unauth"
  exit 1
fi

token=$(curl -s -X POST "$KEYCLOAK_URL/realms/expense/protocol/openid-connect/token" \
  -d "client_id=web" \
  -d "grant_type=password" \
  -d "username=$USER_NAME" \
  -d "password=$PASSWORD")

node -e 'const fs=require("fs"); const body=JSON.parse(process.argv[1]); if(!body.access_token){ console.error(body); process.exit(1);} fs.writeFileSync("/tmp/frs-token","Bearer "+body.access_token);' "$token"

auth=$(curl -s -o /tmp/frs-me.json -w "%{http_code}" -H "Authorization: $(cat /tmp/frs-token)" "$API_URL/me")
if [ "$auth" != "200" ]; then
  echo "登录后 /me 应返回 200，实际 $auth"
  cat /tmp/frs-me.json
  exit 1
fi

node -e 'const me=require("/tmp/frs-me.json"); if(me.username!=="employee1" || me.company.name!=="示例公司"){ console.error(me); process.exit(1);} '

list=$(curl -s -o /tmp/frs-list.json -w "%{http_code}" -H "Authorization: $(cat /tmp/frs-token)" "$API_URL/expense-reports")
if [ "$list" != "200" ]; then
  echo "报销列表应返回 200，实际 $list"
  exit 1
fi
node -e 'const list=require("/tmp/frs-list.json"); if(!Array.isArray(list.items) || list.items.length!==0){ console.error(list); process.exit(1);} '
echo "P0 冒烟通过：未登录被拒绝，登录后只看到示例员工，报销列表为空"
