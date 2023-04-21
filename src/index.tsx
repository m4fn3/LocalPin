import {Plugin, registerPlugin} from 'enmity/managers/plugins'
import {Locale, Native, React, Toasts, Messages} from 'enmity/metro/common'
import {FormRow, View} from "enmity/components"
import {create} from 'enmity/patcher'
// @ts-ignore
import manifest, {name as plugin_name} from '../manifest.json'
import Settings from "./components/Settings"
import {bulk, filters} from "enmity/metro"
import {findInReactTree} from "enmity/utilities"
import {getIDByName} from "enmity/api/assets"
import {addLocalPin, getLocalPin, initPin, removeLocalPin, updatePin} from "./utils/pins"
import {get, set} from "enmity/api/settings"

const Patcher = create('LocalPin')

const [
    ActionSheet,
    ActionSheetNew,
    LazyActionSheet,
] = bulk(
    filters.byProps("EmojiRow"),
    filters.byName("ActionSheet", false),
    filters.byProps("openLazy", "hideActionSheet"),
    filters.byProps("getMessage", "getMessages")
)


const {Version} = Native.InfoDictionaryManager
const PinIcon = getIDByName("ic-location")

const LocalPin: Plugin = {
    ...manifest,
    onStart() {
        let removedLocalPins = {} // cache removed local pins to remove these from internal cached pins
        let pinsLoaded = []
        let last_fetch = 0
        initPin(Patcher, pinsLoaded)
        Patcher.after(View, "render", (self, args, res) => {
            const channelPinsConnected = findInReactTree(res, r => r.type?.name === "ChannelPinsConnected")
            if (channelPinsConnected) {
                Patcher.after(channelPinsConnected, "type", (self, [meta], res) => {
                    let t = new Date().getTime() // prevent infinite loop
                    if ((t - last_fetch) > 1000 && Array.isArray(res.props.messages) && pinsLoaded.includes(meta.channelId)) {
                        last_fetch = t
                        updatePin(meta.channelId, res.props.messages, removedLocalPins).then()
                    }
                })
            }
        })

        // --- Huge thanks to Rosie for this ActionSheet patch <3 ---
        function patchActionSheet(meta, res) {
            let isPinned = meta.message.pinned
            if (isPinned) return
            const finalLocation = findInReactTree(res, r => Array.isArray(r) && r.find(o => typeof o?.key === "string" && typeof o?.props?.message === "string"))
            let isLocalPinned = getLocalPin(meta.channel.id).includes(meta.message.id)
            const button = <FormRow
                label={`${isLocalPinned ? "Unpin" : "Pin"} Message Locally`}
                leading={<FormRow.Icon source={PinIcon}/>}
                onPress={() => {
                    if (isLocalPinned) {
                        removeLocalPin(meta.channel.id, meta.message.id)
                        // 既存の読み込まれたピンから削除するメッセージを追加
                        Object.keys(removedLocalPins).includes(meta.channel.id) ? removedLocalPins[meta.channel.id].push(meta.message.id) : removedLocalPins[meta.channel.id] = [meta.message.id]
                    } else {
                        addLocalPin(meta.channel.id, meta.message.id)
                        // 削除 -> 追加 した場合に正常に処理されるように (本来はupdatePinで削除したらremovedLocalPinsから削除するべきだが,filterで除外してるのでめんどい)
                        if (Object.keys(removedLocalPins).includes(meta.channel.id) && removedLocalPins[meta.channel.id].includes(meta.message.id)) {
                            removedLocalPins[meta.channel.id].splice(removedLocalPins[meta.channel.id].indexOf(meta.message.id), 1)
                        }
                    }
                    Toasts.open({
                        content: `Successfully ${isLocalPinned ? "unpinned" : "pinned"} message locally`,
                        source: getIDByName('ic_check_24px')
                    })
                    LazyActionSheet.hideActionSheet()
                }}
            />
            let elementCopyText = finalLocation.filter(b => b.props?.message === Locale.Messages.MESSAGE_ACTION_REPLY) // find an index to insert the button filtering by a localized string
            let pos = elementCopyText ? (elementCopyText.length ? Number(elementCopyText[0].key) + 1 : undefined) : 2 // FormRow components start with index 1
            if (pos) {
                finalLocation.splice(pos, 0, button)
            }
        }

        if (parseInt(Version.substring(0, 3)) > 164) {
            typeof ActionSheetNew.default === 'function' && Patcher.after(ActionSheetNew, "default", (_, __, res) => {
                const FinalLocation = findInReactTree(res, r => r.sheetKey)
                if (FinalLocation?.sheetKey !== "MessageLongPressActionSheet") return
                Patcher.after(FinalLocation?.content, "type", (_, [meta], res) => {
                    patchActionSheet(meta, res)
                })
            })
        } else {
            typeof ActionSheet.default === 'function' && Patcher.after(ActionSheet, "default", (_, [meta], res) => {
                patchActionSheet(meta, res)
            })
        }
        // ------------------------------------------------------
    },
    onStop() {
        Patcher.unpatchAll()
    }
    ,
    getSettingsPanel({settings}) {
        return <Settings settings={settings}/>
    }
}

registerPlugin(LocalPin)
