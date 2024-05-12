//Pixel Place backend

const fs = require("fs");

const FixedPath = "/www/content/extragon/api/addons/data/pixel/maps/"

function newMap(width = 200, height = 200){
    // for (var i = 0; i < height; i++) {
    //     map[i] = [];
    //     for (var j = 0; j < width; j++) {
    //         map[i][j] = Math.random()>.5?0:1;
    //     }
    // }
    return(new Uint8Array([...split16BitInt(height), ...split16BitInt(width), ...Array(width*height).fill(0)])).buffer
}

class Canvas{
    constructor(file = "test"){
        this.matrix = [];
        this.patch = [];
        this.timelapse=[];
        this.changedSinceSave = false
        this.changedBuffer = false
        this.timeSinceLastPixel = Date.now()
        this.file = FixedPath + file;
        this.connections={};

        if(!fs.existsSync(this.file)){
            this.loadMap(newMap())
        }else{
            let data = fs.readFileSync(this.file);
            this.loadMap(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
            if(fs.existsSync(this.file+"_timelapse")){
                this.timelapse = [...new Uint8Array(fs.readFileSync(this.file+"_timelapse"))]
            }
        }

        let UpdateCycle=()=>{
            if(this.patch.length>0){
                let patchData = new Uint8Array(this.patch);
                for (let c in this.connections){
                    try{
                        this.connections[c].send(patchData)
                    }catch(e){}
                }
                this.patch = [];
            }
            setTimeout(()=>UpdateCycle(), 200)
        }

        UpdateCycle()

        let SaveCycle=()=>{
            if(this.changedSinceSave){
                this.saveMap()
            }
            setTimeout(()=>SaveCycle(), 25000)
        }

        SaveCycle()
    }

    loadMap(map){
        const dataView = new DataView(map);
        const rows = dataView.getUint16(0, false);
        const cols = dataView.getUint16(2, false);
        this.width = cols;
        this.height = rows;
        this.matrix = [];
        let byteOffset = 4;
        for (let y = 0; y < rows; y++) {
            this.matrix[y] = [];
            for (let x = 0; x < cols; x++) {
                this.matrix[y][x]=dataView.getUint8(byteOffset);
                byteOffset++;
            }
        }
    }

    generateBuffer(){
        if(!this.changedBuffer&&this.lastBuffer)return this.lastBuffer;
        // 4 bytes to hold the scale of the canvas.
        const buffer = new ArrayBuffer(4 + (this.height * this.width));
        const dataView = new DataView(buffer);

        // Write the scale into the buffer as 16-bit unsigned integers
        dataView.setUint16(0, this.height, false)
        dataView.setUint16(2, this.width, false)

        // Write matrix values into the ArrayBuffer as 8-bit unsigned integers
        let byteOffset = 4; // Start at byte offset 4 after the scale
        for (let i = 0; i < this.height; i++) {
            for (let j = 0; j < this.width; j++) {
                dataView.setUint8(byteOffset, this.matrix[i][j]);
                byteOffset++;
            }
        }

        // Return the byte array as a Uint8Array
        this.lastBuffer = new Uint8Array(buffer);
        return this.lastBuffer;
    }

    saveMap(){
        if(!this.changedSinceSave)return;
        fs.writeFileSync(this.file, this.generateBuffer())
        fs.writeFileSync(this.file+"_timelapse",new Uint8Array(this.timelapse))
        this.changedSinceSave = false
        this.changedBuffer = false
    }

    inBounds(x, y){
        return (x>-1&&x<this.width) && (y>-1&&y<this.height)
    }

    setPixel(x, y, v){
        if(!this.inBounds(x,y))return;
        if(this.matrix[y][x]==v)return;
        this.changedSinceSave = true
        this.changedBuffer = true
        this.matrix[y][x] = v
        let data=[...split16BitInt(x),...split16BitInt(y),v]
        this.timelapse.push(...data,...split16BitInt(Math.min(Date.now()+this.timeSinceLastPixel,10000)))
        this.patch.push(...data)
        this.timeSinceLastPixel = Date.now()
    }

    extendCanvas(width, height){
        for (var i = 0; i < height; i++) {
            if(!this.matrix[i])this.matrix[i]=this.matrix[i]||[];
            for (var j = 0; j < width; j++) {
                if(!this.matrix[i][j])this.matrix[i][j]=this.matrix[i][j]||0;
            }
        }
        this.width = width;
        this.height = height;
    }
}


let API, Maps={}, colorMap = {
    0:"#ffffff",
    1:"#be0039",
    2:"#ffa800",
    3:"#00a368",
    4:"#7eed56",
    5:"#009eaa",
    6:"#3690ea",
    7:"#493ac1",
    8:"#811e9f",
    9:"#ff3881",
    10:"#6d482f",
    11:"#000000",
    12:"#ff4500",
    13:"#ffd635",
    14:"#00cc78",
    15:"#00756f",
    16:"#2450a4",
    17:"#51e9f4",
    18:"#6a5cff",
    19:"#b44ac0",
    20:"#ff99aa",
    21:"#9c6926",
    22:"#898d90",
    23:"#ff0000",
    24:"#00ff00",
    25:"#0000ff",
    26:"#202020",
    27:"#212121",
    28:"#222222",
    29:"#595959",
    30:"#747474",
    31:"#585858",
    32:"#666666",
    33:"#2f2f2f",
    34:"#c8c8c8",
    35:"#e3e3e3",
    36:"#2e2e2e",
    37:"#3d3d3d",
    38:"#f1f1f1",
    39:"#8f8f8f",
    40:"#828282",
    41:"#909090",
    42:"#acacac",
    43:"#9d9d9d",
    44:"#bababa",
    45:"#3c3c3c",
    46:"#4b4b4b",
    47:"#ababab",
    48:"#d5d5d5",
    49:"#9e9e9e",
    50:"#676767",
    51:"#c7c7c7",
    52:"#4a4a4a",
    53:"#de107f",
    54:"#515252",
    55:"#d4d7d9",
    56:"#ffb470",
    57:"#94b3ff",
    58:"#fff8b8",
    59:"#6d001a",
    60:"#00ccc0",
    61:"#e4abff",
    62:"#e50000",
    63:"#888888",
    64:"#0000ea",
    65:"#e59500",
    66:"#94e044",
    67:"#820080",
    68:"#00d3dd",
    69:"#e5d900",
    70:"#02be01",
    71:"#a06a42",
    72:"#ffa7d1",
    73:"#e4e4e4",
    74:"#cf6ee4",
    75:"#0083c7",
    76:"#0607aa",
    77:"#0d0f59",
    78:"#0c0e62",
    79:"#0506b3",
    80:"#c1c1c7",
    81:"#b6b6bc",
    82:"#121429",
    83:"#fcfcfc",
    84:"#f9f9fa",
    85:"#171a2b",
    86:"#212122",
    87:"#121426",
    88:"#181925",
    89:"#0b0c70",
    90:"#0404c0",
    91:"#0404c3",
    92:"#0304c5",
    93:"#aaabb2",
    94:"#a5a6ad",
    95:"#404351",
    96:"#3e404f",
    97:"#8f9099",
    98:"#f7f7f7",
    99:"#e3e3e6",
    100:"#2e3040",
    101:"#090a8b",
    102:"#1f2233",
    103:"#f4f4f5",
    104:"#e6e6e8",
    105:"#10123b",
    106:"#353847",
    107:"#0000e5",
    108:"#f1f1f2",
    109:"#bebfc4",
    110:"#b4b4ba",
    111:"#0d0f5b",
    112:"#0a0b82",
    113:"#787a84",
    114:"#141729",
    115:"#0e0f57",
    116:"#c3c4ca",
    117:"#323544",
    118:"#aeafb5",
    119:"#2a2d3d",
    120:"#e9e9eb",
    121:"#090a89",
    122:"#494b59",
    123:"#12142b",
    124:"#797a84",
    125:"#73747f",
    126:"#10123e",
    127:"#0b0c72",
    128:"#a2a3aa",
    129:"#666773",
    130:"#191c2e",
    131:"#d8d8db",
    132:"#464856",
    133:"#c7c8cc",
    134:"#9b9ba3",
    135:"#9c9ea5",
    136:"#74757f",
    137:"#82838c",
    138:"#303242",
    139:"#d0d0d4",
    140:"#868891",
    141:"#d5d6d9",
    142:"#07089e",
    143:"#94959d",
    144:"#0a0c79",
    145:"#0102da",
    146:"#0101e3",
    147:"#9899a1",
    148:"#0e0f54",
    149:"#0f1048",
    150:"#4f515e",
    151:"#0a0b7e",
};

API = {
    HandleSocket({Backend, User, req, ws, send, message, shift}){
        let canvas;
        if(ws.map)canvas=Maps[ws.map];
        with(Backend){
            switch(req.event){
                case 0:
                    ws.map=shift();
                    if(!ws.map||ws.map=="backups"||ws.map.endsWith("_timelapse")){
                        ws.close()
                        return
                    }
                    if(!ws.map)return;
                    if(!Maps[ws.map])Maps[ws.map]=new Canvas(ws.map);
                    canvas=Maps[ws.map];

                    //Hello
                    if(!req.url.includes("_unsubscribe"))canvas.connections[ws.uuid]=ws;
                break;
                case 1:
                    if(!canvas)return console.error("huh", ws.uuid);
                    if(message.length==1&&message[0]==0)return ws.send(new Uint8Array(split16BitInt(Object.keys(canvas.connections).length)));
                    if(typeof message!=="object"||message.length<4)return;
                    let dataView = new DataView(new Uint8Array([...message]).buffer);
                    canvas.setPixel(dataView.getUint16(0, false), dataView.getUint16(2, false), dataView.getUint8(4))
                break;
                case 2:
                    //Goodbye
                    delete canvas.connections[ws.uuid];
                break;
            }
        }
    },
    HandleRequest({Backend, User, shift, reply, req, res, assign, success}){
        with(Backend){
            let map = shift();
            if(!map||map=="backups"||map.endsWith("_timelapse")){
                res.wait=true;
                res.setHeader('Content-Type', 'application/octet-stream');
                res.end(new Uint8Array([0]))
                return
            }
            if(!Maps[map])Maps[map]=new Canvas(map);
            let canvas = Maps[map];
            switch(shift()){
                case"canvas":
                    res.wait = true;
                    res.setHeader('Content-Type', 'application/octet-stream');
                    res.end(canvas.generateBuffer())
                break;
                case"timelapse":
                    res.wait = true;
                    res.setHeader('Content-Type', 'application/octet-stream');
                    res.end(new Uint8Array(canvas.timelapse))
                break;
                case"colormap":
                    assign(colorMap)
                break;
                case"extend":
                    //testing purposes only
                    canvas.extendCanvas((+shift())||1000, (+shift())||1000)
                    success()
                break;
                case"playercount":
                    reply.count = Object.keys(canvas.connections).length
                break;
            }
        }
    }
}

function split16BitInt(int) {
    return[(int>>8)&0xFF,int&0xFF]
}

module.exports = API;