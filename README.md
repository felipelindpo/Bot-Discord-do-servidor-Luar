# santaninha-bot

Estrutura inicial de um bot multifuncional para Discord, desenvolvido em TypeScript com discord.js.

## Requisitos
- Node.js 22 ou superior
- Aplicação criada no Discord Developer Portal

## Instalação
1. Extraia o ZIP e abra a pasta no VS Code.
2. Execute `npm install` no terminal.
3. Copie `.env.example` para `.env` e preencha as variáveis.
4. Execute `npm run dev`.

## Configuração do Discord
No Developer Portal, habilite **Server Members Intent** e **Message Content Intent** quando necessários. Para monitorar voz, o bot precisa do intent `GuildVoiceStates` e acesso aos canais relevantes.

Convide o bot com os escopos `bot` e `applications.commands`. Conceda apenas as permissões necessárias.

## Estrutura
- `src/commands`: comandos slash.
- `src/events`: eventos do Discord.
- `src/handlers`: carregamento de comandos e eventos.
- `src/services`: regras de negócio.
- `src/database`: conexão e acesso ao banco.
- `src/ai`: integração futura com IA.
- `src/dashboard`: futura aplicação web.
- `prisma`: futura configuração do Prisma.

Este ZIP contém o esqueleto inicial. Os módulos de moderação, tickets, economia, IA, dashboard, banco de dados e XP serão implementados por etapas.
