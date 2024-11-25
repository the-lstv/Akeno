# Akeno environment setup.sh

if [ "$(id -u)" != "0" ]; then
    echo "This script must be run as root."
    exit 1
fi

echo -e "\x1b[36m\x1b[1mWelcome! The script will now attempt to install Akeno.\x1b[0m"
echo "This script is supported on Fedora/RHEL, Debian/Ubuntu, Arch-based, Alpine, and openSUSE systems."

if command -v dnf &> /dev/null; then
    PM="dnf"
elif command -v apt &> /dev/null; then
    PM="apt"
elif command -v yum &> /dev/null; then
    PM="yum"
elif command -v pacman &> /dev/null; then
    PM="pacman"
elif command -v zypper &> /dev/null; then
    PM="zypper"
elif command -v apk &> /dev/null; then
    PM="apk"
fi

ensure_dependency() {
    PACKAGE=$1
    COMMAND=$2

    if ! command -v "$COMMAND" &> /dev/null; then
        echo "$PACKAGE is not installed. Attempting to install it using $PM..."

        if [ "$PM" = "dnf" ] || [ "$PM" = "yum" ]; then
            $PM install -y "$PACKAGE" || { echo "Failed to install $PACKAGE. Please install it manually using your package manager."; exit 1; }
        elif [ "$PM" = "apt" ]; then
            apt update && apt install -y "$PACKAGE" || { echo "Failed to install $PACKAGE. Please install it manually using your package manager."; exit 1; }
        fi

        case $PM in
            dnf|yum)
                $PM install -y "$PACKAGE" || { echo "Failed to install $PACKAGE using $PM. Please install it manually."; exit 1; }
                ;;
            apt)
                apt update && apt install -y "$PACKAGE" || { echo "Failed to install $PACKAGE using $PM. Please install it manually."; exit 1; }
                ;;
            pacman)
                pacman -Syu --noconfirm "$PACKAGE" || { echo "Failed to install $PACKAGE using $PM. Please install it manually."; exit 1; }
                ;;
            zypper)
                zypper install -y "$PACKAGE" || { echo "Failed to install $PACKAGE using $PM. Please install it manually."; exit 1; }
                ;;
            apk)
                apk add --no-cache "$PACKAGE" || { echo "Failed to install $PACKAGE using $PM. Please install it manually."; exit 1; }
                ;;
        esac

        if ! command -v "$COMMAND" &> /dev/null; then
            echo "$PACKAGE is not installed. Aborting."
            echo "[installer] Please install $PACKAGE using your package manager."
            exit 1
        fi
    fi
}

ensure_dependency nodejs node
ensure_dependency npm npm
ensure_dependency git git
ensure_dependency gcc gcc
ensure_dependency python python3
ensure_dependency gcc-c++ g++

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

mkdir -p /var/www/akeno/ || { echo "Failed to create directory /var/www/akeno/. Aborting."; exit 1; }

if [ ! -d "/usr/lib/akeno" ]; then
    echo "Downloading Akeno into /usr/lib/akeno!"
    mkdir -p /usr/lib/akeno/ || { echo "Failed to create directory /usr/lib/akeno/. Aborting."; exit 1; }

    cd /usr/lib/akeno
    git clone https://github.com/the-lstv/Akeno.git . || { echo "Git clone failed. Please check your internet connection or the repository URL."; exit 1; }
else
    if [ ! -d "/usr/lib/akeno/core/" ]; then
        echo "ERROR: /usr/lib/akeno/ already exists but does but appears to be broken. Please verify the contents of /usr/lib/akeno/ and try again later."
        exit 1
    fi

    echo "Downloading was skipped as /usr/lib/akeno/ already exists. If this was not intended please remove the folder and try again."
fi

if [ ! -f "/usr/bin/akeno" ]; then
    ln -s /usr/lib/akeno/core/cli.js /usr/bin/akeno
    chmod +x /usr/bin/akeno
fi

echo "Installing Node.js modules..."
mkdir -p /usr/lib/akeno/node_modules/
cd /usr/lib/akeno/
npm i uNetworking/uWebSockets.js#v20.49.0
npm i uuid fast-json-stringify bcrypt jsonwebtoken clean-css uglify-js @node-rs/xxhash htmlparser2 minimist
npm i node-lmdb
npm i mysql2 sharp

echo ""
echo -e "\x1b[32m[SETUP COMPLETE] Run \`akeno start\` or \`sudo pm2 start /usr/lib/akeno/app.js --name Akeno\` to start the server!\x1b[0m"