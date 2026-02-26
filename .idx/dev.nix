{ pkgs, ... }: {
  # Usa un canal estable de Nix para asegurar la reproducibilidad.
  channel = "stable-24.05";

  # Lista de paquetes del sistema necesarios para el entorno.
  # Vite es para el servidor de desarrollo de React.
  # Nodemon es para ejecutar el backend.
  packages = [
    pkgs.nodejs_20
    pkgs.nodePackages.nodemon
    pkgs.vite
  ];

  # Configuración específica del editor IDX.
  idx = {
    # Extensiones de VS Code recomendadas para este proyecto.
    extensions = [
      "dbaeumer.vscode-eslint"
      "esbenp.prettier-vscode"
      "dsznajder.es7-react-js-snippets"
    ];

    # Comandos que se ejecutan en diferentes momentos del ciclo de vida del workspace.
    workspace = {
      # 'onCreate' se ejecuta solo la primera vez que se crea el entorno.
      # Instala todas las dependencias de Node.js definidas en package.json.
      onCreate = {
        npm-install = "npm install";
      };

      # 'onStart' se ejecuta cada vez que el workspace inicia o se reinicia.
      # Inicia el servidor backend en segundo plano con el archivo .cjs.
      onStart = {
        backend = "nodemon index.cjs";
      };
    };

    # Configuración de la vista previa del proyecto.
    previews = {
      enable = true;
      previews = {
        web = {
          # Ejecuta el servidor de desarrollo de Vite para el frontend de React.
          # Vite se encargará de comunicarse con el backend gracias a su configuración.
          command = ["npm" "run" "dev" "--" "--port" "$PORT"];
          manager = "web";
        };
      };
    };
  };
}
