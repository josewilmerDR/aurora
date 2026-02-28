{ pkgs, ... }: {
  channel = "unstable";

  packages = [
    pkgs.nodejs_20
    pkgs.vite
    # Solicitamos explícitamente la versión de firebase-tools del ecosistema de Node
    # para asegurar que tenemos la última versión compatible.
    pkgs.nodePackages.firebase-tools
    # Se añade el JDK de Java, necesario para los emuladores de Firebase (Firestore, Auth).
    pkgs.jdk
  ];

  idx = {
    extensions = [
      "dbaeumer.vscode-eslint"
      "esbenp.prettier-vscode"
      "dsznajder.es7-react-js-snippets"
    ];

    workspace = {
      # Se instalan las dependencias para el frontend y el backend.
      onCreate = {
        root-npm-install = "npm install";
        functions-npm-install = "cd functions && npm install";
      };

      onStart = {};
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
