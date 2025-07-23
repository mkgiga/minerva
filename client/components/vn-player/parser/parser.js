
// parser.js

// vnscript is an xml-based file format for visual novel scripts, which interact with an abstraction layer between the parser and the vn-player.
// 
// valid elements:
// 
// <command name="namespaced.command.name">
//     <arg name="arg1">example first argument value</arg>
//     <arg name="arg2">example second argument value</arg>
//     <arg name="arg3">example third argument value</arg>
//     <!-- more args as needed -->
// </command>
// <block>
//     <condition>
//         <!-- js function body that returns true or false. no function declaration, just the body ... -->
//         return someCondition;
//     </condition>
//     <command name="vn.actor.say">
//         <arg name="id">kacey_lindsay</arg>
//         <!-- title argument overrides the actor's name in the rendered textbox, otherwise uses the actor's name -->
//         <arg name="title">Hello, world!</arg>
//         <arg name="text">Hello, world!</arg>
//     </command>
//     <command name="vn.text">
//         <arg name="title">Narrator</arg>
//         <arg name="text">This is a narration text.</arg>
//         <arg name="text">
//             <html>
//                 <p>This is a narration text with <strong>HTML</strong> content.</p>
//                 <p>Everything within a &lt;html&gt; tag will be parsed as HTML and then rendered in the textbox's content area.</p>
//             </html>
//         </arg>
//     </command>
//     <command name="vn.actor.hide">
//         <arg name="id">kacey_lindsay</arg>
//     </command>
//     <command name="vn.actor.show">
//         <arg name="id">kacey_lindsay</arg>
//     </command>
//     <command name="vn.actor.render">
//         <arg name="id">kacey_lindsay</arg>
//         <arg name="layer" layer="face" variant="happy" />
//         <arg name="layer" layer="pose" variant="normal" />
//     </command>
// </block>

/** Standard commands, akin to a programming language's standard library. Available to the vn-player in any script. */
// the 'execute' and 'validate' keys are reserved by the parser and should not be used when defining custom commands, since they imply the object is a leaf node in the namespace tree.
const std = {
    vn: {
        actor: {
            say: {
                validate: (arg) => {
                    // Validate that the arg has a title and text
                    return arg.title && arg.text;
                },
                execute: (context, args = { id: '', title: '', text: '' }) => {

                }
            },
            hide: {
                validate: (arg) => {

                },
                execute: (context, args = { id: '' }) => {

                }
            },
            show: {
                validate: (arg) => {

                },
                execute: (context, args = { id: '' }) => {

                }
            },
        },
        text: {
            validate: (arg) => {

            },

            execute: (context, args = { title: '', text: '' }) => {

            }
        },
    }
}

export class VNScriptParser {
    parse(xmlString) {

    }

    #onParsed(dom) {
        
    }
}