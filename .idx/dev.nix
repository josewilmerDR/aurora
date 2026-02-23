{ pkgs, ... }: {
  channel = "stable-24.05";
  packages = [ pkgs.nodejs_20 ];
  # Las variables de entorno ahora se cargarán desde tu archivo .env.
  idx = {
    extensions = [ "dbaeumer.vscode-eslint" ];
    workspace = {
      onCreate = {
        npm-install = "npm install";
      };
      # El bloque onStart se puede dejar vacío si la vista previa maneja el inicio.
      onStart = {}; 
    };
    previews = {
      enable = true;
      previews = {
        # --- CORRECCIÓN --- #
        # Se cambió el comando para ejecutar la aplicación directamente con Node.js.
        # El entorno del IDE se encargará de pasar la variable $PORT a la aplicación.
        web = {
          command = ["node" "index.js"];
          manager = "web";
        };
      };
    };
  };
}
# Cambio trivial para forzar el reinicio del entorno.