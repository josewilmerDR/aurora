{ pkgs, ... }: {
  channel = "stable-24.05";
  # Se añade nodemon para que el servidor se reinicie automáticamente con los cambios.
  packages = [ 
    pkgs.nodejs_20
    pkgs.nodePackages.nodemon
  ];
  idx = {
    extensions = [ "dbaeumer.vscode-eslint" ];
    workspace = {
      onCreate = {
        npm-install = "npm install";
      };
      onStart = {}; 
    };
    previews = {
      enable = true;
      previews = {
        web = {
          # Se usa nodemon para que el servidor se actualice al detectar cambios en el código.
          command = ["nodemon" "index.js"];
          manager = "web";
        };
      };
    };
  };
}
