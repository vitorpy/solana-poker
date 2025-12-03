//! Program entrypoint using Pinocchio's lazy entrypoint for optimal CU usage

use pinocchio::entrypoint;

use crate::processor::process_instruction;

entrypoint!(process_instruction);
