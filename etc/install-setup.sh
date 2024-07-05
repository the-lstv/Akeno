

# Akeno environment setup.sh

if [ "$(id -u)" != "0" ]; then
    echo "This script must be run as root."
    exit 1
fi

echo -e "\x1b[36m\x1b[1mWelcome to Akeno! The script will now install Akeno and setup your machine with the environment.\x1b[0m"
echo "This is intended for fresh installations and is a complete install."
echo "This is intended primarily for Fedora/RHEL based systems. Compatibility with other distros is not guaranteed."
echo "Required for installation: node, npm, git"


if [ -d "/www" ]; then
    echo ""
    echo "[QUESTION] You already have the /www directory on your system!"
    echo "Are you absolutely sure that you want to continue? If the /www directory contains stuff that is not compatible with Akeno or something else is using it, please do not procceed."
    echo "If it contains fragments compatible with Akeno, like existing user content, websites, configs, it should be safe."
    echo ""
    read -p "Continue? (y/n): " choice
    if [ "$choice" != "y" ]; then
        echo "Exiting (you already have a /www directory)."
        exit 0
    fi
fi

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo ""
    echo "Node.js is not installed. Aborting."
    echo "Please install Node.js using your package manager - for example, 'dnf install nodejs'"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo ""
    echo "NPM is not installed. Aborting."
    echo "Please install NPM using your package manager - for example, 'dnf install npm'"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo ""
    echo "Git is not installed. Aborting."
    echo "Please install git using your package manager - for example, 'dnf install git'"
    exit 1
fi

# Check if pm2 is installed
if ! command -v pm2 &> /dev/null; then
    echo "pm2 is not installed. Installing pm2 globally..."
    npm install -g pm2

    if [ $? -eq 0 ]; then
        echo "pm2 has been installed successfully."
    else
        echo "Failed to install pm2. Aborting."
        exit 1
    fi
fi

echo "Creating directories."

mkdir -p /www/node/shared_modules/node_modules/
mkdir -p /www/node/shell/
mkdir -p /www/content/web/
mkdir -p /www/cmd/bin/


echo ""
echo "[QUESTION] Do you want your server to run in development or production mode? This affects caching, security, and anything that checks for development more. You can change this at any time by changing the environment type."
echo ""
read -p "(dev/prod, default is prod): " choice

if [ "$choice" = "dev" ]; then
    echo ""
    echo "The server will be setup as a development server"
    touch /www/__dev__
else
    echo ""
    echo "The server will be setup as a production server"
    touch /www/__prod__
fi


if [ ! -f "/www/global" ]; then
    echo "Setting up global shell script at /www/global - Akeno guardian is disabled by default."

    touch /etc/profile.d/akeno.environment_global.sh
    ln -s /etc/profile.d/akeno.environment_global.sh /www/global

    echo "alias cls=clear

node_env=\"/www/node/shared_modules/node_modules/\"

alias sl=ls

export NODE_PATH=\"\$node_env:/www/node/shared_modules/custom_modules/\"
export PATH=\$PATH:/www/cmd/bin/" >> /www/global
    chmod +x /www/global
fi

if [ ! -d "/www/content/akeno" ]; then
    echo "Cloning the backend from GitHub into /www/content/akeno!"
    mkdir -p /www/content/akeno/

    cd /www/content/akeno
    git clone https://github.com/the-lstv/Akeno.git .
else
    if [ ! -d "/www/content/akeno/core/" ]; then
        echo "ERROR: /www/content/akeno already exists but does but appears to be broken. Cannot setup the CLI. Please verify the contents of /www/content/akeno and try again later."
        exit 1
    fi

    echo "Cloning the backend from GitHub was SKIPPED as /www/content/akeno already exists. If this was not intended please do this later manually (git clone https://github.com/the-lstv/Akeno.git /www/content/akeno)."
fi

if [ ! -f "/www/cmd/bin/akeno" ]; then
    ln -s /www/content/akeno/core/cli.js /www/cmd/bin/akeno
    chmod +x /www/cmd/bin/akeno
fi

if [ ! -f "/www/boot" ]; then
    echo "Setting up startup script service at /www/boot."

    touch /etc/systemd/system/akeno.bootScript.service
    touch /www/boot

    echo "[Unit]
Description=Akeno Boot script
After=network.target

[Service]
ExecStart=/etc/systemd/system/akeno.bootScript.service

[Install]
WantedBy=multi-user.target" >> /etc/systemd/system/akeno.bootScript.service

    ln -s /etc/systemd/system/akeno.bootScript.service /www/boot
    chmod +x /www/boot

    systemctl daemon-reload

    systemctl enable akeno.bootScript.service

    echo "Running boot script."
    bash /www/boot
fi

touch /www/content/akeno/etc/hits

echo "Installing node modules."

cd /www/node/shared_modules/
npm i uNetworking/uWebSockets.js#v20.44.0 uuid fast-json-stringify bcrypt jsonwebtoken clean-css uglify-js mime fs-extra formidable mysql2 axios sharp

echo ""
echo -e "\x1b[32m[SETUP] Setup complete.\x1b[0m"
echo "! PLEASE NOTE: Before you can use the CLI and the Akeno shell, please log out and back in or run \"bash /www/global\" in your bash. !"