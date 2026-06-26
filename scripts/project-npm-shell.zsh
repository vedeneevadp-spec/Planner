#!/bin/zsh

unset NODE
unset NPM_CONFIG_MIN_RELEASE_AGE npm_config_min_release_age
unset NPM_CONFIG_PREFIX npm_config_prefix
unset NPM_CONFIG_SCRIPT_SHELL npm_config_script_shell
unset NPM_CONFIG_USERCONFIG npm_config_userconfig

export NVM_DIR="$HOME/.nvm"
script_dir="${0:A:h}"
repo_root="${script_dir:h}"

if [[ -s "$NVM_DIR/nvm.sh" ]]; then
  source "$NVM_DIR/nvm.sh" --no-use
  nvm use --silent "$(cat "$repo_root/.nvmrc")" >/dev/null
fi

exec /bin/zsh "$@"
