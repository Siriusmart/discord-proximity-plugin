import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, GuildMemberStore, SelectedChannelStore, SelectedGuildStore, UserStore } from "@webpack/common";

let whosThere = {}
let whosThereReverse = {}
let originalVolumes = {}

let ws;
let isActive = false;

let localVolumeSetter = findByPropsLazy("setLocalVolume");
let localVolumeGetter = findByPropsLazy("getLocalVolume");

function restore(): void {
    for(let [user, volume] of Object.entries(originalVolumes)) {
        localVolumeSetter.setLocalVolume(user, volume)
    }

    originalVolumes = {}

    XMLHttpRequest.prototype.send = XMLHttpRequest.prototype.oldSend;
    XMLHttpRequest.prototype.open = XMLHttpRequest.prototype.oldOpen;
}

function connect(): void {
    XMLHttpRequest.prototype.oldOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.oldSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (...args) {
        this.isProto = args[1].includes("settings-proto");
        this.oldOpen(...args);
    };

    XMLHttpRequest.prototype.send = function (...args) {
        if (this.isProto) {
            console.log("Blocked attempt to sync user settings.");
            return;
        }
        else this.oldSend(...args);
    };
}

function bindWS(): void {
    const myId = UserStore.getCurrentUser().id;
    if(isActive == false) return;
    if(whosThereReverse[myId] == undefined) return;

    try {
        ws = new WebSocket("ws://127.0.0.1:25560/api/subscription");
            ws.onopen = () => {
            console.log("Connected to proximity websocket.");
            connect();
            ws.send(JSON.stringify({
                t: "clear",
                c: 0
            }));

            let targets = Object.keys(whosThere[whosThereReverse[myId]]).filter((id) => id != myId);

            if(targets.length != 0) {
                ws.send(JSON.stringify({
                    t: "sub",
                    c: targets
                }));
            }
        }

        let connected = false;

        ws.onmessage = ({data}) => {
            data = JSON.parse(data);

            switch(data.t) {
                case "connected": {
                    connected = true;
                    break
                }
                case "set": {
                    if(!connected) break;

                    for(let [userId, multiplier] of Object.entries(data.c)) {
                        if(originalVolumes[userId] == undefined) {
                            originalVolumes[userId] = localVolumeGetter.getLocalVolume(userId);
                        }

                        localVolumeSetter.setLocalVolume(userId, originalVolumes[userId] * multiplier);
                    }
                }

            }
        }

        ws.onclose = ws.onerror = () => {
            if (ws.readyState === WebSocket.CLOSED) {
                ws == undefined
                restore();
                setTimeout(bindWS, 10000);
            }
        }
    } catch(e) {
        ws = undefined
        setTimeout(bindWS, 10000);
    }
}

interface VoiceState {
    userId: string;
    channelId?: string;
    oldChannelId?: string;
    deaf: boolean;
    mute: boolean;
    selfDeaf: boolean;
    selfMute: boolean;
}

export default definePlugin({
    name: "DiscordProximity",
    description: "Proximity voice chat plugin for Discord.",
        authors: [Devs.Siriusmart],

    start: () => {
        isActive = true;
        bindWS();
    },

    stop: () => {
        isActive = false;
        restore();
    },

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceState[]; }) {
            const myId = UserStore.getCurrentUser().id;
            const myChanId = SelectedChannelStore.getVoiceChannelId();

            if (ChannelStore.getChannel(myChanId!)?.type === 13 /* Stage Channel */) return;

            for (const state of voiceStates) {
                if(state.channelId == null) {
                    try {
                        if(originalVolumes[state.userId] != undefined) {
                            localVolumeSetter.setLocalVolume(state.userId, originalVolumes[state.userId])
                        }

                        delete whosThereReverse[state.userId]
                        if(state.oldChannelId != null) {
                            delete whosThere[state.oldChannelId][state.userId]
                            if(Object.keys(whosThere[state.oldChannelId]).length == 0) {
                                delete whosThere[state.oldChannelId]
                            }
                        }
                    } catch(e) {
                        console.error(e);
                    }

                    if(state.userId == myId) {
                        if(ws != undefined) {
                            ws.close();
                            ws = undefined
                        }

                        restore();
                    }
                } else {
                    if(state.oldChannelId != null && state.oldChannelId != state.channelId) {
                        try {
                            delete whosThereReverse[state.userId]
                            delete whosThere[state.oldChannelId][state.userId]
                        } catch(e) {
                            console.error(e);
                        }
                    }
                    whosThereReverse[state.userId] = state.channelId;
                    whosThere[state.channelId] ??= {};
                    whosThere[state.channelId][state.userId] = true;

                    if(ws == undefined) {
                        bindWS()
                    }
                }
            }
        }
    }
});
