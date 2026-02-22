{ pkgs, ... }: {
  channel = "stable-24.05";
  packages = [ pkgs.nodejs_20 ];
  # El bloque 'env' con las claves secretas ha sido eliminado.
  # Las variables de entorno ahora se cargarán desde tu archivo .env,
  # que no está siendo rastreado por Git, lo cual es la práctica correcta.
  idx = {
    extensions = [ "dbaeumer.vscode-eslint" ];
    workspace = {
      onCreate = {
        npm-install = "npm install";
      };
      onStart = {}; # Dejado vacío intencionalmente
    };
    previews = {
      enable = true;
      previews = {
        web = {
          command = ["npm" "run" "dev" "--" "--port" "$PORT"];
          manager = "web";
        };
      };
    };
  };
}
