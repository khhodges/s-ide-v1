// ============================================================================
// CTMM LOAD Instruction - Wrapper for LOAD Subroutine
// ============================================================================
// This module implements the LOAD instruction by:
//   1. Invoking the shared LOAD subroutine to fetch the capability
//   2. Writing the result to the destination register CRd
//
// The actual capability fetching is done by ctmm_load_subroutine.sv
// This reduces the Trusted Computing Base - all Church instructions
// share the same verified subroutine for capability fetching.
// ============================================================================

module ctmm_load_microcode
    import ctmm_pkg::*;
(
    input  logic        clk,
    input  logic        rst_n,
    
    // Control interface
    input  logic        load_start,           // Start LOAD execution
    input  logic [3:0]  cr_src,               // Source register (CRn)
    input  logic [3:0]  cr_dst,               // Destination register (CRd)
    input  logic [7:0]  index,                // C-List index
    output logic        load_busy,            // LOAD in progress
    output logic        load_complete,        // LOAD finished successfully
    output logic        load_fault,           // LOAD caused a fault
    output fault_type_t fault_type,           // Type of fault
    
    // Capability register read interface
    output logic [3:0]  cr_rd_addr,           // Register to read
    input  capability_reg_t cr_rd_data,       // Full 256-bit register data
    
    // Capability register write interface
    output logic [3:0]  cr_wr_addr,           // Register to write
    output capability_reg_t cr_wr_data,       // Full 256-bit data to write
    output logic        cr_wr_en,             // Write enable
    
    // CR15 (Namespace) interface
    input  capability_reg_t cr15_namespace,   // CR15 Namespace register
    
    // Memory interface
    output logic [63:0] mem_addr,             // Memory address
    output logic        mem_rd_en,            // Read enable
    input  logic [63:0] mem_rd_data,          // Read data
    input  logic        mem_rd_valid,         // Read data valid
    
    // G bit reset interface
    output logic        g_bit_reset,
    output logic [63:0] g_bit_addr
);

    // ========================================================================
    // State Machine - LOAD instruction wrapper
    // ========================================================================
    
    typedef enum logic [2:0] {
        LOAD_IDLE,
        LOAD_START_SUB,
        LOAD_WAIT_ACK,
        LOAD_CALL_SUB,
        LOAD_WRITE_DST,
        LOAD_DONE
    } load_wrapper_state_t;
    
    load_wrapper_state_t state, next_state;
    
    // Latched destination register
    logic [3:0] cr_dst_reg;
    
    // ========================================================================
    // LOAD Subroutine Instance
    // ========================================================================
    
    logic        sub_start;
    logic        sub_busy;
    logic        sub_done;
    logic        sub_fault;
    fault_type_t sub_fault_type;
    capability_reg_t sub_result;
    
    ctmm_load_subroutine u_load_sub (
        .clk            (clk),
        .rst_n          (rst_n),
        
        // Subroutine interface
        .sub_start      (sub_start),
        .sub_cr_src     (cr_src),
        .sub_index      (index),
        .sub_busy       (sub_busy),
        .sub_done       (sub_done),
        .sub_fault      (sub_fault),
        .sub_fault_type (sub_fault_type),
        .sub_result     (sub_result),
        
        // Register read interface
        .cr_rd_addr     (cr_rd_addr),
        .cr_rd_data     (cr_rd_data),
        
        // Namespace interface
        .cr15_namespace (cr15_namespace),
        
        // Memory interface
        .mem_addr       (mem_addr),
        .mem_rd_en      (mem_rd_en),
        .mem_rd_data    (mem_rd_data),
        .mem_rd_valid   (mem_rd_valid),
        
        // G bit reset
        .g_bit_reset    (g_bit_reset),
        .g_bit_addr     (g_bit_addr)
    );
    
    // ========================================================================
    // State Register
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state <= LOAD_IDLE;
            cr_dst_reg <= 4'd0;
        end else begin
            state <= next_state;
            
            // Latch destination register on start
            if (state == LOAD_IDLE && load_start)
                cr_dst_reg <= cr_dst;
        end
    end
    
    // ========================================================================
    // Next State Logic - Proper Start/Ack Handshake
    // ========================================================================
    // LOAD_IDLE -> LOAD_START_SUB: assert sub_start
    // LOAD_START_SUB -> LOAD_WAIT_ACK: wait for sub_busy (ack)
    // LOAD_WAIT_ACK -> LOAD_CALL_SUB: only after sub_busy observed
    // LOAD_CALL_SUB: wait for sub_done or sub_fault
    // ========================================================================
    
    always_comb begin
        next_state = state;
        sub_start = 1'b0;
        
        case (state)
            LOAD_IDLE: begin
                if (load_start)
                    next_state = LOAD_START_SUB;
            end
            
            LOAD_START_SUB: begin
                sub_start = 1'b1;  // Assert start
                next_state = LOAD_WAIT_ACK;
            end
            
            LOAD_WAIT_ACK: begin
                sub_start = 1'b1;  // Keep start asserted until ack
                if (sub_busy)
                    next_state = LOAD_CALL_SUB;  // Subroutine acknowledged
            end
            
            LOAD_CALL_SUB: begin
                if (sub_done)
                    next_state = LOAD_WRITE_DST;
                else if (sub_fault)
                    next_state = LOAD_DONE;
            end
            
            LOAD_WRITE_DST: begin
                next_state = LOAD_DONE;
            end
            
            LOAD_DONE: begin
                next_state = LOAD_IDLE;
            end
            
            default: next_state = LOAD_IDLE;
        endcase
    end
    
    // ========================================================================
    // Output Signals
    // ========================================================================
    
    assign load_busy = (state != LOAD_IDLE);
    assign load_complete = (state == LOAD_DONE) && !sub_fault;
    assign load_fault = (state == LOAD_DONE) && sub_fault;
    assign fault_type = sub_fault_type;
    
    // Write to destination register
    assign cr_wr_addr = cr_dst_reg;
    assign cr_wr_data = sub_result;
    assign cr_wr_en = (state == LOAD_WRITE_DST);

endmodule
