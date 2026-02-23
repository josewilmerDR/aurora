{ pkgs, ... }: {
  channel = "stable-24.05";
  packages = [ pkgs.nodejs_20 ];
  idx = {
    extensions = [ "dbaeumer.vscode-eslint" ];
    workspace = {
      onCreate = {
        npm-install = "npm install";
      };
      onStart = {}; 
    };
    previews = {
      enable = true; # Corrección: Cambiado , por ;
      previews = {
        web = {
          command = ["node" "index.js"];
          manager = "web";
        };
      };
    };
  };
}
