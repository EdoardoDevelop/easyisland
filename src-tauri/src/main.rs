// EasyIsland runs without a console window: the character is the whole UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    easyisland_lib::run()
}
