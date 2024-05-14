

# Akeno environment setup.sh

if [ "$(id -u)" != "0" ]; then
    echo "This script must be run as root."
    exit 1
fi

echo "Welcome to Akeno! The script will now install Akeno and setup your machine with the environment."
echo "This is intended for fresh installations and is a complete install."
echo "Do NOT procceed if you already have a different or conflicting environment."


if [ -d "/www" ]; then
    echo ""
    read -p "You already have the /www directory on your system! Are you absolutely sure that you want to continue? If the /www directory contains stuff that is not compatible with Akeno or something else is using it, please do not procceed. If it contains fragments compatible with Akeno, like existing user content, websites, configs, it should be safe. (y/n): " choice
    if [ "$choice" != "y" ]; then
        echo "Exiting."
        exit 0
    fi
fi

echo "Creating directories."

mkdir -p /www/node/shared_modules/node_modules/
mkdir -p /www/node/shell/
mkdir -p /www/content/akeno/
mkdir -p /www/content/web/
mkdir -p /www/cmd/bin/

touch /www/__prod__

if [ ! -f "/www/global" ]; then
    echo "Setting up global shell at /www/global - guardian is disabled by default."

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

    cd /www/content/akeno
    git clone https://github.com/the-lstv/Akeno.git
else
    if [ ! -d "/www/content/akeno/addons/" ]; then
        echo "ERROR: /www/content/akeno already exists but does but appears to be broken. Cannot setup the CLI. Please verify the contents of /www/content/akeno and try again later."
        exit 1
    fi

    echo "Cloning the backend from GitHub was SKIPPED as /www/content/akeno already exists. If this was not intended please do this later manually."
fi


ln -s /www/content/akeno/addons/akeno/cli.js /www/cmd/bin/akeno
chmod +x /www/cmd/bin/akeno

if [ ! -f "/www/global" ]; then
    echo "Setting up startup script service at /www/boot."

    touch /etc/systemd/system/akeno.bootScript.service

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

echo "Setup complete."
echo "! PLEASE NOTE: Before you can use the CLI and the Akeno shell, please log out and back in or run \"bash /www/global\" in your bash. !"